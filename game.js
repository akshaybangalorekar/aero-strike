(function(){
'use strict';

/* ============================== DOM ============================== */
var $ = function(id){ return document.getElementById(id); };
var video=$('cam'), canvas=$('gl'), gate=$('gate'), startBtn=$('start'), statusEl=$('gateStatus');
var hud=$('hud'), scoreEl=$('score'), waveEl=$('wave'), tgtEl=$('tgt'), msgEl=$('msg');
var fireBtn=$('fire'), recenterBtn=$('recenter'), fpsEl=$('fps');
var lockBox=$('lockbox'), lockLabel=$('locklabel');

/* ============================== RNG ============================== */
var _seed = 987654321;
function RNG(){ _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; }
function rnd(a,b){ return a + (b-a)*RNG(); }
function rndi(a,b){ return Math.floor(rnd(a, b+0.9999)); }
function pick(arr){ return arr[Math.floor(RNG()*arr.length) % arr.length]; }

/* ============================== RENDERER ============================== */
var renderer = new THREE.WebGLRenderer({canvas:canvas, antialias:true, alpha:true, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearAlpha(0);
if ('outputColorSpace' in renderer && THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;

var scene = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1600);
camera.position.set(0, 1.55, 0);

scene.add(new THREE.HemisphereLight(0xa8c8ff, 0x2a2c22, 1.3));
var sun = new THREE.DirectionalLight(0xfff0d2, 1.5); sun.position.set(70,120,50); scene.add(sun);
var rim = new THREE.DirectionalLight(0x5fa8ff, 0.6); rim.position.set(-80,45,-70); scene.add(rim);

/* ============================== TEXTURES ============================== */
function canvasTex(w,h,draw){
  var c = document.createElement('canvas'); c.width=w; c.height=h;
  draw(c.getContext('2d'), w, h);
  var t = new THREE.CanvasTexture(c);
  if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

var softDot = canvasTex(64,64,function(x,w,h){
  var g = x.createRadialGradient(w/2,h/2,0,w/2,h/2,w/2);
  g.addColorStop(0,'rgba(255,255,255,1)');
  g.addColorStop(0.32,'rgba(255,255,255,0.62)');
  g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g; x.fillRect(0,0,w,h);
});

function facadeTex(tint, lit){
  return canvasTex(96,192,function(x,w,h){
    x.fillStyle = tint; x.fillRect(0,0,w,h);
    x.fillStyle = 'rgba(0,0,0,0.20)';
    for (var s=1; s<3; s++) x.fillRect(0, s*h/3 - 2, w, 3);
    var cols=3, rows=6, cw=w/cols, ch=h/rows;
    for (var i=0;i<cols;i++) for (var j=0;j<rows;j++){
      var on = RNG() < lit;
      x.fillStyle = on ? (RNG()<0.5 ? 'rgba(255,212,138,0.95)' : 'rgba(150,215,255,0.9)')
                       : 'rgba(8,12,18,0.88)';
      x.fillRect(i*cw + cw*0.22, j*ch + ch*0.24, cw*0.56, ch*0.42);
    }
  });
}

var groundTex = canvasTex(512,512,function(x,w,h){
  x.clearRect(0,0,w,h);
  var g = x.createRadialGradient(w/2,h/2,w*0.03,w/2,h/2,w*0.5);
  g.addColorStop(0.0,'rgba(26,70,84,0.46)');
  g.addColorStop(0.5,'rgba(18,50,64,0.30)');
  g.addColorStop(0.82,'rgba(10,30,42,0.13)');
  g.addColorStop(1.0,'rgba(0,0,0,0)');
  x.fillStyle=g; x.fillRect(0,0,w,h);
});

/* ============================== GROUND ============================== */
var ground = new THREE.Mesh(
  new THREE.CircleGeometry(340, 72),
  new THREE.MeshBasicMaterial({map:groundTex, transparent:true, depthWrite:false, side:THREE.DoubleSide})
);
ground.rotation.x = -Math.PI/2;
ground.position.y = -0.03;
scene.add(ground);

var grid = new THREE.GridHelper(340, 68, 0x39b6e8, 0x1d5871);
grid.position.y = 0;
grid.material.transparent = true;
grid.material.opacity = 0.17;
grid.material.depthWrite = false;
scene.add(grid);

[40,80,120,160].forEach(function(r){
  var m = new THREE.Mesh(
    new THREE.RingGeometry(r-0.22, r+0.22, 96),
    new THREE.MeshBasicMaterial({color:0x37c8ff, transparent:true, opacity:0.20, side:THREE.DoubleSide, depthWrite:false})
  );
  m.rotation.x = -Math.PI/2; m.position.y = 0.02; scene.add(m);
});

/* ============================== TARGETS ============================== */
var targets = [];       // everything destructible
var markers = [];       // floating enemy markers
var dishes  = [];       // rotating radar dishes
var vehicles= [];       // moving units

var boxGeo = new THREE.BoxGeometry(1,1,1);
var buildingMats = [
  new THREE.MeshLambertMaterial({map:facadeTex('#3a4048',0.42)}),
  new THREE.MeshLambertMaterial({map:facadeTex('#2f3a3f',0.34)}),
  new THREE.MeshLambertMaterial({map:facadeTex('#474340',0.46)}),
  new THREE.MeshLambertMaterial({map:facadeTex('#33393f',0.38)}),
  new THREE.MeshLambertMaterial({map:facadeTex('#404a4a',0.30)}),
  new THREE.MeshLambertMaterial({map:facadeTex('#2b3238',0.44)})
];
buildingMats.forEach(function(m){
  m.map.repeat.set(1.6, 3.2);
  m.map.needsUpdate = true;
});

var markerGeo = new THREE.OctahedronGeometry(0.85, 0);
var markerMat = new THREE.MeshBasicMaterial({color:0xff4433, transparent:true, opacity:0.9});

function registerTarget(mesh, kind, hp, radius, value){
  var t = {mesh:mesh, kind:kind, hp:hp, maxHp:hp, radius:radius, value:value, alive:true, vel:null, wpos:new THREE.Vector3()};
  mesh.userData.target = t;
  targets.push(t);
  return t;
}

function addMarker(parent, y){
  var m = new THREE.Mesh(markerGeo, markerMat);
  m.position.y = y;
  parent.add(m);
  markers.push(m);
  return m;
}

/* --- buildings --- */
function makeBuilding(x,z){
  var w = rnd(5,11), h = rnd(7,26), d = rnd(5,11);
  var m = new THREE.Mesh(boxGeo, pick(buildingMats));
  m.scale.set(w,h,d);
  m.position.set(x, h/2, z);
  m.rotation.y = rnd(0, Math.PI*2);
  scene.add(m);
  return registerTarget(m, 'building', 80, Math.max(w,d)*0.58, 120);
}

/* --- radar / command installation --- */
var instMat   = new THREE.MeshLambertMaterial({color:0x4a4f42});
var instMat2  = new THREE.MeshLambertMaterial({color:0x33382f});
var dishMat   = new THREE.MeshLambertMaterial({color:0x8d9490, side:THREE.DoubleSide, flatShading:true});
var redLightMat = new THREE.MeshBasicMaterial({color:0xff2a1a});

function makeInstallation(x,z){
  var g = new THREE.Group();
  g.position.set(x,0,z);
  g.rotation.y = rnd(0, Math.PI*2);

  var base = new THREE.Mesh(new THREE.BoxGeometry(8,2.4,8), instMat);
  base.position.y = 1.2; g.add(base);

  var bunker = new THREE.Mesh(new THREE.BoxGeometry(4.6,3.2,4.6), instMat2);
  bunker.position.set(0,3.9,0); g.add(bunker);

  var post = new THREE.Mesh(new THREE.CylinderGeometry(0.35,0.45,3.4,6), instMat2);
  post.position.set(0,6.9,0); g.add(post);

  var dish = new THREE.Group();
  dish.position.set(0,8.6,0);
  var d = new THREE.Mesh(new THREE.SphereGeometry(2.6,14,8,0,Math.PI*2,0,Math.PI*0.42), dishMat);
  d.rotation.x = -Math.PI*0.62;
  dish.add(d);
  var feed = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,2.6,5), instMat2);
  feed.rotation.x = -Math.PI*0.62; feed.position.set(0,0.4,0.9); dish.add(feed);
  g.add(dish); dishes.push(dish);

  var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3,8,6), redLightMat);
  lamp.position.set(0,11.4,0); g.add(lamp);
  g.userData.lamp = lamp;

  var h1 = new THREE.Mesh(new THREE.BoxGeometry(6,0.4,1.2), instMat2);
  h1.position.set(0,2.6,0); g.add(h1);

  scene.add(g);
  addMarker(g, 14);
  return registerTarget(g, 'installation', 170, 6.2, 600);
}

/* --- enemy vehicle --- */
var hullMat   = new THREE.MeshLambertMaterial({color:0x3f4a35});
var turretMat = new THREE.MeshLambertMaterial({color:0x2d3628});
var trackMat  = new THREE.MeshLambertMaterial({color:0x1b1f1a});

function makeVehicle(x,z, orbit){
  var g = new THREE.Group();
  var hull = new THREE.Mesh(new THREE.BoxGeometry(4.4,1.3,2.5), hullMat);
  hull.position.y = 1.05; g.add(hull);
  var turret = new THREE.Mesh(new THREE.BoxGeometry(2.3,0.85,1.9), turretMat);
  turret.position.y = 2.1; g.add(turret);
  var barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11,0.11,2.6,6), turretMat);
  barrel.rotation.x = Math.PI/2; barrel.position.set(0,2.15,-2.1); g.add(barrel);
  for (var i=0;i<2;i++){
    var tr = new THREE.Mesh(new THREE.BoxGeometry(4.7,0.85,0.5), trackMat);
    tr.position.set(0,0.45, i? 1.15 : -1.15); g.add(tr);
  }
  scene.add(g);
  addMarker(g, 5.2);
  var t = registerTarget(g, 'vehicle', 45, 2.9, 250);
  t.orbit = orbit;
  t.vel = new THREE.Vector3();
  vehicles.push(t);
  return t;
}

/* --- trees (instanced) --- */
var treeCount = 0;
var treePositions = [];
function plantTrees(){
  var N = treePositions.length;
  if (!N) return;
  var trunkGeo = new THREE.CylinderGeometry(0.32,0.5,2.6,5);
  var leafGeo  = new THREE.ConeGeometry(2.3,6.4,6);
  var trunkMat = new THREE.MeshLambertMaterial({color:0x584535});
  var leafMat  = new THREE.MeshLambertMaterial({color:0x2f7d4f, flatShading:true});
  var trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  var leaf  = new THREE.InstancedMesh(leafGeo,  leafMat,  N);
  var mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (var i=0;i<N;i++){
    var tp = treePositions[i];
    var sc = rnd(0.62, 1.15);
    q.setFromAxisAngle(new THREE.Vector3(0,1,0), rnd(0,6.28));
    s.set(sc,sc,sc);
    p.set(tp.x, 1.3*sc, tp.z);  mtx.compose(p,q,s); trunk.setMatrixAt(i, mtx);
    p.set(tp.x, (2.6 + 3.2)*sc, tp.z); mtx.compose(p,q,s); leaf.setMatrixAt(i, mtx);
  }
  trunk.instanceMatrix.needsUpdate = true;
  leaf.instanceMatrix.needsUpdate = true;
  scene.add(trunk); scene.add(leaf);
}

/* --- lake --- */
var lakes = [];
function makeLake(x,z,r){
  var water = new THREE.Mesh(
    new THREE.CircleGeometry(r, 48),
    new THREE.MeshLambertMaterial({color:0x1f6fa8, transparent:true, opacity:0.62, depthWrite:false})
  );
  water.rotation.x = -Math.PI/2;
  water.position.set(x, 0.06, z);
  scene.add(water);

  var shore = new THREE.Mesh(
    new THREE.RingGeometry(r, r*1.09, 48),
    new THREE.MeshBasicMaterial({color:0x74d7ff, transparent:true, opacity:0.35, side:THREE.DoubleSide, depthWrite:false})
  );
  shore.rotation.x = -Math.PI/2;
  shore.position.set(x, 0.05, z);
  scene.add(shore);

  var ripple = new THREE.Mesh(
    new THREE.RingGeometry(r*0.3, r*0.33, 40),
    new THREE.MeshBasicMaterial({color:0x9fe8ff, transparent:true, opacity:0.30, side:THREE.DoubleSide, depthWrite:false})
  );
  ripple.rotation.x = -Math.PI/2;
  ripple.position.set(x, 0.07, z);
  scene.add(ripple);

  lakes.push({x:x, z:z, r:r, ripple:ripple});
}

/* ============================== WORLD LAYOUT ============================== */
var BASES = [];
function buildWorld(){
  var bearings = [0.35, 1.62, 2.85, 4.10, 5.35];
  bearings.forEach(function(b, bi){
    var dist = 62 + (bi%3)*16 + rnd(-6,6);
    var cx = Math.sin(b)*dist, cz = Math.cos(b)*dist;
    BASES.push({x:cx, z:cz, r:24});

    var nB = rndi(7,10);
    for (var i=0;i<nB;i++){
      var a = rnd(0,6.283), rr = rnd(4, 21);
      makeBuilding(cx + Math.sin(a)*rr, cz + Math.cos(a)*rr);
    }
    var nI = rndi(1,3);
    for (var j=0;j<nI;j++){
      var a2 = rnd(0,6.283), r2 = rnd(2, 14);
      makeInstallation(cx + Math.sin(a2)*r2, cz + Math.cos(a2)*r2);
    }
    var nV = rndi(3,5);
    for (var k=0;k<nV;k++){
      var a3 = rnd(0,6.283), r3 = rnd(9, 17);
      makeVehicle(cx + Math.sin(a3)*r3, cz + Math.cos(a3)*r3, {
        cx:cx, cz:cz, r:r3, a:a3, w:rnd(0.06,0.16)*(RNG()<0.5?-1:1)
      });
    }
    // trees around the base
    for (var t=0;t<14;t++){
      var a4 = rnd(0,6.283), r4 = rnd(24, 46);
      treePositions.push({x: cx + Math.sin(a4)*r4, z: cz + Math.cos(a4)*r4});
    }
  });

  // lakes in the gaps between bases
  [1.0, 2.25, 3.5, 4.75].forEach(function(b, i){
    if (i === 2) return;
    var d = rnd(46, 88);
    makeLake(Math.sin(b)*d, Math.cos(b)*d, rnd(11, 22));
  });

  // scattered trees
  for (var i=0;i<90;i++){
    var a = rnd(0,6.283), r = rnd(30, 130);
    var tx = Math.sin(a)*r, tz = Math.cos(a)*r;
    var inLake = lakes.some(function(l){ return Math.hypot(tx-l.x, tz-l.z) < l.r*1.15; });
    if (!inLake) treePositions.push({x:tx, z:tz});
  }
  plantTrees();
}

/* ============================== FRIENDLY JETS ============================== */
var jets = [];
var flightCenter = new THREE.Vector3(0,0,55);

function makeJet(idx){
  var g = new THREE.Group();
  var bodyMat = new THREE.MeshLambertMaterial({color:0xdfe9f5});
  var wingMat = new THREE.MeshLambertMaterial({color:0xb9c8d8});

  var body = new THREE.Mesh(new THREE.ConeGeometry(0.85, 6.4, 8), bodyMat);
  body.rotation.x = -Math.PI/2;
  g.add(body);

  var wing = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.16, 1.9), wingMat);
  wing.position.set(0, -0.05, 0.5); g.add(wing);

  var tail = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.16, 1.1), wingMat);
  tail.position.set(0, 0.05, 2.5); g.add(tail);

  var fin = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.5, 1.2), wingMat);
  fin.position.set(0, 0.8, 2.6); g.add(fin);

  var cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshBasicMaterial({color:0x64e2ff}));
  cockpit.position.set(0, 0.42, -0.9); cockpit.scale.set(1,0.7,1.5); g.add(cockpit);

  var glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({color:0x7fe6ff, transparent:true, opacity:0.85}));
  glow.position.set(0,0,3.1); g.add(glow);

  scene.add(g);
  return {
    mesh:g, glow:glow,
    angle: idx * 2.09,
    radius: 46 + idx*7,
    alt: 26 + idx*5,
    speed: 0.26 + idx*0.035,
    alive: true,
    respawn: 0,
    pos: new THREE.Vector3(),
    fwd: new THREE.Vector3(0,0,-1),
    bob: idx*1.7
  };
}

function resetJets(){
  jets.forEach(function(j){ j.alive = true; j.respawn = 0; j.mesh.visible = true; });
}
function jetsAlive(){
  var n = 0; jets.forEach(function(j){ if (j.alive) n++; }); return n;
}
function nearestJet(p){
  var best = null, bd = 1e9;
  jets.forEach(function(j){
    if (!j.alive) return;
    var d = j.pos.distanceToSquared(p);
    if (d < bd){ bd = d; best = j; }
  });
  return best;
}

/* ============================== PARTICLES ============================== */
var PARTICLE_VERT = [
  'attribute vec3 pcolor;',
  'attribute float palpha;',
  'attribute float psize;',
  'uniform float uScale;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main(){',
  '  vColor = pcolor;',
  '  vAlpha = palpha;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  gl_PointSize = max(1.0, psize * uScale / max(-mv.z, 0.6));',
  '  gl_Position = projectionMatrix * mv;',
  '}'
].join('\n');

var PARTICLE_FRAG = [
  'uniform sampler2D uMap;',
  'varying vec3 vColor;',
  'varying float vAlpha;',
  'void main(){',
  '  vec4 t = texture2D(uMap, gl_PointCoord);',
  '  float a = t.a * vAlpha;',
  '  if (a < 0.012) discard;',
  '  gl_FragColor = vec4(vColor, a);',
  '  #include <colorspace_fragment>',
  '}'
].join('\n');

var particleFields = [];

function ParticleField(max, worldSize){
  this.max = max; this.cursor = 0; this.worldSize = worldSize; this.alphaScale = 1;
  this.px = new Float32Array(max*3);
  this.pv = new Float32Array(max*3);
  this.pc = new Float32Array(max*3);
  this.pa = new Float32Array(max);
  this.ps = new Float32Array(max);
  this.base = new Float32Array(max*3);
  this.life = new Float32Array(max);
  this.ttl  = new Float32Array(max);
  for (var i=0;i<max;i++){ this.px[i*3+1] = -9999; this.ps[i] = worldSize; }

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(this.px, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('pcolor',   new THREE.BufferAttribute(this.pc, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('palpha',   new THREE.BufferAttribute(this.pa, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('psize',    new THREE.BufferAttribute(this.ps, 1).setUsage(THREE.DynamicDrawUsage));
  this.geo = geo;

  var mat = new THREE.ShaderMaterial({
    uniforms: { uMap: {value: softDot}, uScale: {value: 800} },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true
  });
  this.mat = mat;
  this.mesh = new THREE.Points(geo, mat);
  this.mesh.frustumCulled = false;
  scene.add(this.mesh);
  particleFields.push(this);
}

ParticleField.prototype.spawn = function(x,y,z, vx,vy,vz, ttl, col, size){
  var i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
  var k = i*3;
  this.px[k]=x; this.px[k+1]=y; this.px[k+2]=z;
  this.pv[k]=vx; this.pv[k+1]=vy; this.pv[k+2]=vz;
  this.base[k]=col.r; this.base[k+1]=col.g; this.base[k+2]=col.b;
  this.pc[k]=col.r; this.pc[k+1]=col.g; this.pc[k+2]=col.b;
  this.ps[i] = size || this.worldSize;
  this.pa[i] = this.alphaScale;
  this.life[i]=ttl; this.ttl[i]=ttl;
  this.geo.attributes.pcolor.needsUpdate = true;
  this.geo.attributes.psize.needsUpdate = true;
};

ParticleField.prototype.update = function(dt){
  var px=this.px, pv=this.pv, pa=this.pa, ps=this.ps, life=this.life, ttl=this.ttl;
  var drag = Math.pow(0.10, dt);
  for (var i=0;i<this.max;i++){
    if (life[i] <= 0){
      if (pa[i] !== 0) pa[i] = 0;
      continue;
    }
    var k = i*3;
    life[i] -= dt;
    if (life[i] <= 0){ pa[i] = 0; continue; }
    pv[k+1] -= 9.81 * dt * 0.45;
    pv[k] *= drag; pv[k+1] *= drag; pv[k+2] *= drag;
    px[k]   += pv[k]*dt;
    px[k+1] += pv[k+1]*dt;
    px[k+2] += pv[k+2]*dt;
    if (px[k+1] < 0.25){ px[k+1] = 0.25; pv[k+1] *= -0.28; pv[k]*=0.7; pv[k+2]*=0.7; }
    var f = life[i]/ttl[i];
    pa[i] = this.alphaScale * (f < 0.35 ? (f/0.35) : 1.0);   // fade out at the end of life
    ps[i] = this.worldSize * (1 + (1-f) * 1.15); // puffs expand as they age
  }
  this.geo.attributes.position.needsUpdate = true;
  this.geo.attributes.palpha.needsUpdate = true;
  this.geo.attributes.psize.needsUpdate = true;
};

function updateParticleScale(){
  var h = window.innerHeight * Math.min(window.devicePixelRatio || 1, 2);
  var s = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  for (var i=0;i<particleFields.length;i++) particleFields[i].mat.uniforms.uScale.value = s;
}

var sparks = new ParticleField(900, 0.85);
var smoke  = new ParticleField(500, 2.0);
smoke.alphaScale = 0.46;

var C_HOT    = new THREE.Color(0xfff0b8);
var C_FIRE   = new THREE.Color(0xff9a3c);
var C_EMBER  = new THREE.Color(0xff5a1e);
var C_SMOKE  = new THREE.Color(0x9fadb8);
var C_TRAIL  = new THREE.Color(0x8fd8ff);

/* ============================== EXPLOSION FX POOLS ============================== */
var rings = [], flashes = [];
for (var ri=0; ri<10; ri++){
  var rm = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.0, 40),
    new THREE.MeshBasicMaterial({color:0xffcf8a, transparent:true, opacity:0, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthWrite:false})
  );
  rm.rotation.x = -Math.PI/2; rm.visible = false; scene.add(rm);
  rings.push({mesh:rm, t:0, life:0, max:1});
}
for (var fi=0; fi<8; fi++){
  var fm = new THREE.Mesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({color:0xffdca8, transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false})
  );
  fm.visible = false; scene.add(fm);
  flashes.push({mesh:fm, t:0, life:0, max:1, size:1});
}

var _ringI = 0, _flashI = 0;
function spawnRing(p, size, color){
  var r = rings[_ringI++ % rings.length];
  r.mesh.position.set(p.x, Math.max(p.y, 0.15), p.z);
  r.mesh.scale.setScalar(0.5);
  r.mesh.material.color.set(color);
  r.mesh.visible = true;
  r.t = 0; r.life = 0.55; r.max = size;
}
function spawnFlash(p, size){
  var f = flashes[_flashI++ % flashes.length];
  f.mesh.position.copy(p);
  f.mesh.scale.setScalar(size*0.3);
  f.mesh.visible = true;
  f.t = 0; f.life = 0.3; f.size = size;
}

function randDir(out){
  var u = RNG()*2 - 1, th = RNG()*Math.PI*2, s = Math.sqrt(1-u*u);
  out.set(s*Math.cos(th), u, s*Math.sin(th));
  return out;
}
var _d = new THREE.Vector3();

function boom(p, radius){
  spawnFlash(p, radius*0.55);
  spawnRing(p, radius, 0xffcf8a);
  var i, sp, dir;
  for (i=0;i<30;i++){
    dir = randDir(_d); sp = 9 + RNG()*30;
    sparks.spawn(p.x, p.y, p.z, dir.x*sp, dir.y*sp + 7, dir.z*sp,
      0.4 + RNG()*0.55, RNG()<0.5 ? C_HOT : C_FIRE, 0.45 + RNG()*0.5);
  }
  for (i=0;i<16;i++){
    dir = randDir(_d); sp = 3 + RNG()*11;
    smoke.spawn(p.x, p.y, p.z, dir.x*sp, Math.abs(dir.y)*sp + 4, dir.z*sp,
      1.1 + RNG()*1.5, C_SMOKE, 1.6 + RNG()*1.8);
  }
  for (i=0;i<10;i++){
    dir = randDir(_d); sp = 5 + RNG()*16;
    sparks.spawn(p.x, p.y, p.z, dir.x*sp, Math.abs(dir.y)*sp + 2, dir.z*sp,
      0.8 + RNG()*0.7, C_EMBER, 0.7 + RNG()*0.4);
  }
}

/* ============================== MISSILES ============================== */
var missileGeo = new THREE.ConeGeometry(0.30, 2.4, 6);
var missileMat = new THREE.MeshBasicMaterial({color:0xffe6b0});
var missiles = [];
for (var mi=0; mi<30; mi++){
  var mm = new THREE.Mesh(missileGeo, missileMat);
  mm.rotation.x = -Math.PI/2;
  mm.visible = false;
  scene.add(mm);
  missiles.push({
    mesh:mm, alive:false, age:0,
    pos:new THREE.Vector3(), vel:new THREE.Vector3(),
    target:null, trail:0
  });
}

var _fwd4 = new THREE.Vector3();
var _aim  = new THREE.Vector3();
var _des  = new THREE.Vector3();
var _dv   = new THREE.Vector3();
var _dvN  = new THREE.Vector3();
var _lead = new THREE.Vector3();

function launchMissile(target){
  var m = null;
  for (var i=0;i<missiles.length;i++){ if (!missiles[i].alive){ m = missiles[i]; break; } }
  if (!m) return;

  var origin;
  var jet = target ? nearestJet(target.wpos) : nearestJet(flightCenter);
  if (jet){
    _fwd4.set(0,0,-1).applyQuaternion(jet.mesh.quaternion);
    origin = jet.pos.clone().addScaledVector(_fwd4, 3.2).add(new THREE.Vector3(0,-0.6,0));
  } else {
    camera.getWorldDirection(_fwd4);
    origin = camera.position.clone().addScaledVector(_fwd4, 6).add(new THREE.Vector3(0, 22, 0));
  }

  m.alive = true; m.age = 0; m.target = target; m.trail = 0;
  m.pos.copy(origin);

  if (target){
    _aim.copy(target.wpos).sub(origin).normalize();
  } else {
    camera.getWorldDirection(_aim);
    _aim.y = Math.max(_aim.y, -0.25);
    _aim.normalize();
  }
  m.vel.copy(_aim).multiplyScalar(85);
  m.mesh.visible = true;
  m.mesh.position.copy(m.pos);

  playLaunch();
  for (var s=0;s<8;s++){
    sparks.spawn(origin.x, origin.y, origin.z,
      rnd(-3,3), rnd(-2,2), rnd(-3,3), 0.35+RNG()*0.3, C_TRAIL, 0.55);
  }
}

function detonate(p, radius, power){
  boom(p, radius);
  playBoom(Math.min(1, power/150));

  for (var i=0;i<targets.length;i++){
    var t = targets[i];
    if (!t.alive) continue;
    var d = t.wpos.distanceTo(p);
    if (d > radius) continue;
    var dmg = power * (1 - d/radius);
    if (d < t.radius) dmg = Math.max(dmg, power);
    t.hp -= dmg;
    if (t.hp <= 0) killTarget(t, true);
  }
}

function killTarget(t, chain){
  t.alive = false;
  t.mesh.visible = false;
  state.score += t.value;
  state.kills++;
  state.aliveCount--;
  updateScoreHud();

  var wp = t.wpos;
  for (var i=0;i<10;i++){
    sparks.spawn(wp.x, wp.y + 1, wp.z, rnd(-9,9), rnd(2,14), rnd(-9,9), 0.5+RNG()*0.6, C_EMBER, 0.6 + RNG()*0.4);
  }
  if (t.kind === 'installation'){
    toast('COMMAND POST DESTROYED  +' + t.value, '#ffb347');
    if (chain) detonate(wp.clone(), 11, 110);   // secondary explosions
  } else if (t.kind === 'vehicle'){
    toast('+' + t.value + '  ARMOUR KILL', '#ffd479');
  } else {
    toast('+' + t.value, '#9fe8ff');
  }
  if (state.aliveCount <= 0) waveCleared();
}

function distToSegment(px,py,pz, ax,ay,az, bx,by,bz){
  var vx=bx-ax, vy=by-ay, vz=bz-az;
  var wx=px-ax, wy=py-ay, wz=pz-az;
  var vv=vx*vx+vy*vy+vz*vz;
  var t = vv > 0 ? (wx*vx+wy*vy+wz*vz)/vv : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  var dx=wx-vx*t, dy=wy-vy*t, dz=wz-vz*t;
  return Math.sqrt(dx*dx+dy*dy+dz*dz);
}

function updateMissiles(dt){
  for (var i=0;i<missiles.length;i++){
    var m = missiles[i];
    if (!m.alive) continue;

    m.age += dt;
    var px0 = m.pos.x, py0 = m.pos.y, pz0 = m.pos.z;
    var speed = m.vel.length();

    if (m.target && m.target.alive){
      // lead pursuit
      _aim.copy(m.target.wpos);
      if (m.target.vel) _lead.copy(m.target.vel).multiplyScalar(Math.min(1.2, m.target.wpos.distanceTo(m.pos)/Math.max(speed,1)));
      else _lead.set(0,0,0);
      _aim.add(_lead).sub(m.pos).normalize();

      _des.copy(_aim).multiplyScalar(speed);
      _dv.copy(_des).sub(m.vel);
      var maxDv = 118 * dt;                    // limited lateral G
      if (_dv.length() > maxDv) _dv.setLength(maxDv);
      m.vel.add(_dv);
    }

    // thrust along current heading
    if (speed < 195){
      _dvN.copy(m.vel).normalize();
      m.vel.addScaledVector(_dvN, 135 * dt);
    }

    // gravity
    m.vel.y -= 9.81 * dt;

    // quadratic drag
    var dragK = 0.00085 * m.vel.length() * dt;
    m.vel.multiplyScalar(Math.max(0, 1 - dragK));

    m.pos.addScaledVector(m.vel, dt);

    // orient
    _dvN.copy(m.vel).normalize();
    m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,-1), _dvN);
    m.mesh.position.copy(m.pos);

    // exhaust trail
    m.trail -= dt;
    if (m.trail <= 0){
      m.trail = 0.022;
      smoke.spawn(m.pos.x, m.pos.y, m.pos.z, rnd(-1,1), rnd(-1,1), rnd(-1,1), 0.9 + RNG()*0.7, C_SMOKE, 0.7 + RNG()*0.5);
      sparks.spawn(m.pos.x, m.pos.y, m.pos.z, rnd(-2,2), rnd(-2,2), rnd(-2,2), 0.22, C_FIRE, 0.5);
    }

    // fuse — swept test so fast missiles cannot tunnel through a small target
    var hit = false;
    for (var j=0;j<targets.length;j++){
      var t = targets[j];
      if (!t.alive) continue;
      if (distToSegment(t.wpos.x, t.wpos.y, t.wpos.z,
                        px0, py0, pz0, m.pos.x, m.pos.y, m.pos.z) < t.radius + 2.0){ hit = true; break; }
    }
    if (!hit && m.pos.y < 0.6) hit = true;
    if (!hit && m.age > 16) hit = true;

    if (hit){
      m.alive = false;
      m.mesh.visible = false;
      detonate(m.pos.clone(), 13.5, 150);
    }
  }
}

/* ============================== ENEMY AA ============================== */
var tracers = [];
var tracerGeo = new THREE.SphereGeometry(0.32, 6, 5);
var tracerMat = new THREE.MeshBasicMaterial({color:0xff6a3c});
for (var ti=0; ti<14; ti++){
  var tm = new THREE.Mesh(tracerGeo, tracerMat);
  tm.visible = false; scene.add(tm);
  tracers.push({mesh:tm, alive:false, pos:new THREE.Vector3(), vel:new THREE.Vector3(), age:0});
}
var aaTimer = 5;

function fireAA(){
  if (jetsAlive() === 0) return;
  var shooters = targets.filter(function(t){ return t.alive && t.kind === 'installation'; });
  if (!shooters.length) return;
  var src = pick(shooters);
  var jet = pick(jets.filter(function(j){ return j.alive; }));
  if (!jet) return;

  for (var i=0;i<tracers.length;i++){
    var tr = tracers[i];
    if (tr.alive) continue;
    tr.alive = true; tr.age = 0;
    tr.pos.copy(src.wpos).add(new THREE.Vector3(0, 9, 0));
    tr.vel.copy(jet.pos).sub(tr.pos).normalize().multiplyScalar(240);
    tr.vel.x += rnd(-14,14); tr.vel.y += rnd(-6,14); tr.vel.z += rnd(-14,14);
    tr.mesh.visible = true;
    break;
  }
}

function updateTracers(dt){
  for (var i=0;i<tracers.length;i++){
    var tr = tracers[i];
    if (!tr.alive) continue;
    tr.age += dt;
    tr.pos.addScaledVector(tr.vel, dt);
    tr.vel.y -= 9.81 * dt * 0.5;
    tr.mesh.position.copy(tr.pos);
    sparks.spawn(tr.pos.x, tr.pos.y, tr.pos.z, rnd(-1,1), rnd(-1,1), rnd(-1,1), 0.25, C_EMBER, 0.35);

    var done = tr.age > 3 || tr.pos.y < 0.4;
    for (var j=0;j<jets.length;j++){
      var jet = jets[j];
      if (!jet.alive) continue;
      if (tr.pos.distanceTo(jet.pos) < 3.0){
        jet.alive = false; jet.mesh.visible = false; jet.respawn = 6;
        boom(jet.pos.clone(), 7);
        playBoom(0.8);
        toast('AIRCRAFT LOST — REPLACEMENT INBOUND', '#ff7a66');
        done = true;
        break;
      }
    }
    if (done){ tr.alive = false; tr.mesh.visible = false; }
  }
}

/* ============================== AUDIO ============================== */
var actx = null, noiseBuf = null, master = null;
function initAudio(){
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  master = actx.createGain();
  master.gain.value = 0.55;
  master.connect(actx.destination);

  var len = Math.floor(actx.sampleRate * 1.2);
  noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
  var d = noiseBuf.getChannelData(0);
  for (var i=0;i<len;i++) d[i] = Math.random()*2 - 1;
}
function playLaunch(){
  if (!actx || actx.state !== 'running') return;
  var t = actx.currentTime;
  var src = actx.createBufferSource(); src.buffer = noiseBuf;
  var bp = actx.createBiquadFilter(); bp.type='bandpass'; bp.Q.value=1.4;
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t+0.22);
  var g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t+0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.4);
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(t); src.stop(t+0.45);
}
function playBoom(power){
  if (!actx || actx.state !== 'running') return;
  var t = actx.currentTime;
  var src = actx.createBufferSource(); src.buffer = noiseBuf;
  var lp = actx.createBiquadFilter(); lp.type='lowpass';
  lp.frequency.setValueAtTime(1100, t);
  lp.frequency.exponentialRampToValueAtTime(90, t+0.55);
  var g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.30*power, t+0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.75);
  src.connect(lp); lp.connect(g); g.connect(master);
  src.start(t); src.stop(t+0.8);

  var osc = actx.createOscillator(); osc.type='sine';
  osc.frequency.setValueAtTime(95, t);
  osc.frequency.exponentialRampToValueAtTime(34, t+0.4);
  var og = actx.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.26*power, t+0.02);
  og.gain.exponentialRampToValueAtTime(0.0001, t+0.5);
  osc.connect(og); og.connect(master);
  osc.start(t); osc.stop(t+0.55);
}
function playLock(){
  if (!actx || actx.state !== 'running') return;
  var t = actx.currentTime;
  var o = actx.createOscillator(); o.type='square'; o.frequency.value = 1180;
  var g = actx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.05, t+0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t+0.07);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t+0.08);
}

/* ============================== ORIENTATION ============================== */
var _zee = new THREE.Vector3(0,0,1);
var _q0 = new THREE.Quaternion();
var _q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
var _euler = new THREE.Euler();
var deviceQ = new THREE.Quaternion();
var _camQ = new THREE.Quaternion();
var hasOrient = false;
var yawOffset = 0;
var yawQ = new THREE.Quaternion();
var YAXIS = new THREE.Vector3(0,1,0);

function screenAngleDeg(){
  if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number')
    return window.screen.orientation.angle;
  if (typeof window.orientation === 'number') return window.orientation;
  return 0;
}

function onOrient(e){
  if (e.alpha === null || e.alpha === undefined) return;
  hasOrient = true;
  var a = THREE.MathUtils.degToRad(e.alpha);
  var b = THREE.MathUtils.degToRad(e.beta || 0);
  var g = THREE.MathUtils.degToRad(e.gamma || 0);
  var so = THREE.MathUtils.degToRad(screenAngleDeg());
  _euler.set(b, a, -g, 'YXZ');
  deviceQ.setFromEuler(_euler);
  deviceQ.multiply(_q1);
  deviceQ.multiply(_q0.setFromAxisAngle(_zee, -so));
}

// drag-look fallback
var dragYaw = 0, dragPitch = 0;

/* ============================== LOCK & FIRE ============================== */
var state = { running:false, score:0, kills:0, wave:1, aliveCount:0, lockTarget:null, fireCd:0 };
var camFwd = new THREE.Vector3();
var _v1 = new THREE.Vector3();
var _v2 = new THREE.Vector3();
var _proj = new THREE.Vector3();
var pinned = null, pinTimer = 0;

function updateLock(dt){
  camera.getWorldDirection(camFwd);

  if (pinned && (!pinned.alive || pinTimer <= 0)) pinned = null;
  if (pinTimer > 0) pinTimer -= dt;

  var best = null, bestScore = 1e9, bestAng = 0.28;   // ~16 degrees
  for (var i=0;i<targets.length;i++){
    var t = targets[i];
    if (!t.alive) continue;
    _v1.copy(t.wpos).sub(camera.position);
    var dist = _v1.length();
    if (dist > 320) continue;
    _v1.normalize();
    var ang = Math.acos(Math.max(-1, Math.min(1, _v1.dot(camFwd))));
    if (ang >= bestAng) continue;
    var sc = ang + Math.min(dist, 200) * 0.00035;
    if (sc < bestScore){ bestScore = sc; best = t; }
  }
  if (pinned) best = pinned;

  var prev = state.lockTarget;
  state.lockTarget = best;
  if (best && best !== prev) playLock();

  // HUD lock box
  if (best){
    _proj.copy(best.wpos).project(camera);
    if (_proj.z < 1 && _proj.z > -1){
      var w = window.innerWidth, h = window.innerHeight;
      var px = (_proj.x*0.5 + 0.5) * w;
      var py = (-_proj.y*0.5 + 0.5) * h;
      lockBox.style.left = px + 'px';
      lockBox.style.top  = py + 'px';
      lockBox.classList.add('on');
      var d = Math.round(best.wpos.distanceTo(camera.position));
      lockLabel.textContent = (best.kind === 'installation' ? 'COMMAND POST' :
                               best.kind === 'vehicle' ? 'ARMOUR' : 'STRUCTURE')
                               + ' · ' + d + 'M';
    } else {
      lockBox.classList.remove('on');
    }
  } else {
    lockBox.classList.remove('on');
  }
}

function tryFire(){
  if (!state.running || state.fireCd > 0) return;
  state.fireCd = 0.24;
  launchMissile(state.lockTarget);
  state.fired = (state.fired || 0) + 1;
}

/* ============================== WAVES ============================== */
function countAlive(){
  var n = 0;
  for (var i=0;i<targets.length;i++) if (targets[i].alive) n++;
  return n;
}
function waveCleared(){
  toast('SECTOR CLEARED — REGROUPING', '#9dff9d');
  setTimeout(function(){
    if (!state.running) return;
    state.wave++;
    waveEl.textContent = 'WAVE ' + state.wave;
    respawnAll();
    toast('WAVE ' + state.wave + ' — NEW CONTACTS', '#8fe3ff');
  }, 2600);
}
function respawnAll(){
  for (var i=0;i<targets.length;i++){
    var t = targets[i];
    t.alive = true; t.hp = t.maxHp; t.mesh.visible = true;
    if (t.kind === 'vehicle' && t.orbit){
      t.orbit.a = rnd(0, 6.283);
      t.orbit.w = Math.abs(t.orbit.w) * (RNG()<0.5 ? -1 : 1);
    }
  }
  state.aliveCount = targets.length;
  resetJets();
  updateScoreHud();
}

/* ============================== HUD ============================== */
var lastScore = -1, lastTgt = -1;
function updateScoreHud(){
  if (state.score !== lastScore){
    lastScore = state.score;
    scoreEl.textContent = String(state.score).padStart(5, '0');
  }
  if (state.aliveCount !== lastTgt){
    lastTgt = state.aliveCount;
    tgtEl.textContent = String(state.aliveCount);
  }
}
var msgTimer = 0;
function toast(text, color){
  msgEl.textContent = text;
  msgEl.style.color = color || '#8fe3ff';
  msgEl.classList.add('show');
  msgTimer = 1.5;
}

/* ============================== INPUT ============================== */
var firing = false;
var ptrDown = false, ptrMoved = 0, ptrX = 0, ptrY = 0;

function canvasPointerDown(e){
  if (!state.running) return;
  ptrDown = true; ptrMoved = 0;
  ptrX = e.clientX; ptrY = e.clientY;
}
function canvasPointerMove(e){
  if (!ptrDown) return;
  var dx = e.clientX - ptrX, dy = e.clientY - ptrY;
  ptrMoved += Math.abs(dx) + Math.abs(dy);
  if (!hasOrient){
    dragYaw   -= dx * 0.0042;
    dragPitch -= dy * 0.0042;
    dragPitch = Math.max(-1.25, Math.min(1.25, dragPitch));
  }
  ptrX = e.clientX; ptrY = e.clientY;
}
function canvasPointerUp(e){
  if (!ptrDown) return;
  ptrDown = false;
  if (ptrMoved < 16 && state.running){
    // tap = try to lock whatever was tapped, then fire
    var hit = pickTargetAt(e.clientX, e.clientY);
    if (hit){ pinned = hit; pinTimer = 4.0; state.lockTarget = hit; }
    tryFire();
  }
}

var raycaster = new THREE.Raycaster();
var ndc = new THREE.Vector2();
function pickTargetAt(cx, cy){
  ndc.x = (cx / window.innerWidth) * 2 - 1;
  ndc.y = -(cy / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  var objs = [];
  for (var i=0;i<targets.length;i++) if (targets[i].alive) objs.push(targets[i].mesh);
  var hits = raycaster.intersectObjects(objs, true);
  for (var h=0; h<hits.length; h++){
    var o = hits[h].object;
    while (o && !o.userData.target) o = o.parent;
    if (o && o.userData.target) return o.userData.target;
  }
  return null;
}

/* ============================== RESIZE ============================== */
function resize(){
  var w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // match the phone's rear camera so the overlay sits at the right scale
  camera.fov = (h > w) ? 68 : 54;
  camera.updateProjectionMatrix();
  updateParticleScale();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', function(){ setTimeout(resize, 250); });
document.addEventListener('contextmenu', function(e){ e.preventDefault(); });

/* ============================== MAIN LOOP ============================== */
var last = 0, acc = 0;
var frames = 0, fpsT = 0;
var _tmp = new THREE.Vector3();

function updateJets(dt, t){
  // flight centre follows the engaged target
  var focus = state.lockTarget ? state.lockTarget.wpos : null;
  if (focus){
    _tmp.set(focus.x, 0, focus.z).multiplyScalar(0.62);
  } else {
    _tmp.set(flightCenter.x, 0, flightCenter.z);
  }
  flightCenter.x += (_tmp.x - flightCenter.x) * Math.min(1, dt*0.9);
  flightCenter.z += (_tmp.z - flightCenter.z) * Math.min(1, dt*0.9);

  for (var i=0;i<jets.length;i++){
    var j = jets[i];
    if (!j.alive){
      j.respawn -= dt;
      if (j.respawn <= 0){ j.alive = true; j.mesh.visible = true; }
      continue;
    }
    j.angle += j.speed * dt;
    var x = flightCenter.x + Math.cos(j.angle) * j.radius;
    var z = flightCenter.z + Math.sin(j.angle) * j.radius;
    var y = j.alt + Math.sin(t*0.7 + j.bob) * 1.4;
    j.pos.set(x, y, z);

    var nx = flightCenter.x + Math.cos(j.angle + 0.12) * j.radius;
    var nz = flightCenter.z + Math.sin(j.angle + 0.12) * j.radius;
    j.mesh.position.copy(j.pos);
    j.mesh.lookAt(nx, y, nz);
    j.mesh.rotateZ(0.42);
    j.fwd.set(0,0,-1).applyQuaternion(j.mesh.quaternion);
    j.glow.material.opacity = 0.6 + Math.sin(t*14 + i)*0.25;
  }
}

function updateVehicles(dt, t){
  for (var i=0;i<vehicles.length;i++){
    var v = vehicles[i];
    if (!v.alive){ v.vel.set(0,0,0); continue; }
    var o = v.orbit;
    o.a += o.w * dt;
    var nx = o.cx + Math.sin(o.a) * o.r;
    var nz = o.cz + Math.cos(o.a) * o.r;
    var px = v.mesh.position.x, pz = v.mesh.position.z;
    v.vel.set((nx-px)/Math.max(dt,0.001), 0, (nz-pz)/Math.max(dt,0.001));
    v.mesh.position.set(nx, 0, nz);
    v.mesh.rotation.y = Math.atan2(nx-px, nz-pz);
  }
}

function updateMarkers(dt, t){
  for (var i=0;i<markers.length;i++){
    var m = markers[i];
    if (!m.parent || !m.parent.visible) continue;
    m.rotation.y += dt * 1.6;
    m.position.y += Math.sin(t*2.2 + i)*0.006;
  }
  for (var d=0; d<dishes.length; d++) dishes[d].rotation.y += dt * 0.55;
}

function updateFX(dt){
  sparks.update(dt);
  smoke.update(dt);
  for (var i=0;i<rings.length;i++){
    var r = rings[i];
    if (!r.mesh.visible) continue;
    r.t += dt;
    var f = r.t / r.life;
    if (f >= 1){ r.mesh.visible = false; continue; }
    r.mesh.scale.setScalar(0.5 + f * r.max * 1.15);
    r.mesh.material.opacity = (1 - f) * 0.85;
  }
  for (var j=0;j<flashes.length;j++){
    var fl = flashes[j];
    if (!fl.mesh.visible) continue;
    fl.t += dt;
    var g = fl.t / fl.life;
    if (g >= 1){ fl.mesh.visible = false; continue; }
    fl.mesh.scale.setScalar(fl.size * (0.3 + g*1.1));
    fl.mesh.material.opacity = (1 - g) * 0.9;
  }
  for (var k=0;k<lakes.length;k++){
    var lk = lakes[k];
    var s = 1 + Math.sin(performance.now()*0.0009 + k)*0.06;
    lk.ripple.scale.set(s, s, 1);
    lk.ripple.material.opacity = 0.18 + Math.sin(performance.now()*0.0012 + k)*0.1;
  }
}

function frame(now){
  requestAnimationFrame(frame);
  if (!last) last = now;
  var dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  var t = now / 1000;

  // fps
  frames++; fpsT += dt;
  if (fpsT > 0.5){
    fpsEl.textContent = Math.round(frames / fpsT) + ' FPS';
    frames = 0; fpsT = 0;
  }

  if (state.running){
    // camera orientation
    if (hasOrient){
      yawQ.setFromAxisAngle(YAXIS, yawOffset);
      _camQ.copy(yawQ).multiply(deviceQ);
      camera.quaternion.slerp(_camQ, Math.min(1, dt*18));
    } else {
      _euler.set(dragPitch, dragYaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(_euler);
    }

    // refresh world positions
    for (var i=0;i<targets.length;i++){
      if (targets[i].alive) targets[i].mesh.getWorldPosition(targets[i].wpos);
    }

    updateJets(dt, t);
    updateVehicles(dt, t);
    updateMarkers(dt, t);
    updateMissiles(dt);
    updateTracers(dt);
    updateFX(dt);
    camera.updateMatrixWorld(true);
    updateLock(dt);

    state.fireCd -= dt;
    if (firing) tryFire();

    aaTimer -= dt;
    if (aaTimer <= 0){
      aaTimer = rnd(3.5, 7.0);
      if (RNG() < 0.75) fireAA();
    }

    if (msgTimer > 0){
      msgTimer -= dt;
      if (msgTimer <= 0) msgEl.classList.remove('show');
    }
    updateScoreHud();
  }

  renderer.render(scene, camera);
}

/* ============================== START ============================== */
async function startGame(){
  startBtn.disabled = true;
  statusEl.textContent = 'Requesting motion sensors…';

  var motionOK = true;
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function'){
      motionOK = (await DeviceOrientationEvent.requestPermission()) === 'granted';
    }
  } catch (err){ motionOK = false; }

  if (motionOK){
    window.addEventListener('deviceorientation', onOrient, true);
  } else {
    statusEl.textContent = 'Motion sensor denied — use drag to look around.';
  }

  try { initAudio(); if (actx && actx.state === 'suspended') await actx.resume(); } catch (err){}

  statusEl.textContent = 'Starting camera…';
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no getusermedia');
    var stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    document.body.classList.remove('nocam');
  } catch (err){
    document.body.classList.add('nocam');
    statusEl.textContent = 'Camera unavailable — running on synthetic sky.';
  }

  resize();
  buildWorld();
  jets.push(makeJet(0), makeJet(1), makeJet(2));
  state.aliveCount = countAlive();
  state.running = true;
  last = 0;

  gate.classList.add('hide');
  hud.classList.add('on');
  updateScoreHud();

  setTimeout(function(){ toast('MOVE TO ACQUIRE TARGETS', '#8fe3ff'); }, 700);

  // keep the screen awake if the platform allows it
  try {
    if ('wakeLock' in navigator){
      var wl = navigator.wakeLock.request('screen');
      if (wl && wl.catch) wl.catch(function(){});
    }
  } catch (err){}
}

/* ============================== BIND ============================== */
startBtn.addEventListener('click', function(e){ e.preventDefault(); startGame(); });

canvas.addEventListener('pointerdown', canvasPointerDown);
canvas.addEventListener('pointermove', canvasPointerMove);
canvas.addEventListener('pointerup', canvasPointerUp);
canvas.addEventListener('pointercancel', function(){ ptrDown = false; });

fireBtn.addEventListener('pointerdown', function(e){ e.preventDefault(); e.stopPropagation(); firing = true; tryFire(); });
fireBtn.addEventListener('pointerup', function(e){ e.preventDefault(); e.stopPropagation(); firing = false; });
fireBtn.addEventListener('pointerleave', function(){ firing = false; });
fireBtn.addEventListener('pointercancel', function(){ firing = false; });

recenterBtn.addEventListener('pointerdown', function(e){
  e.preventDefault(); e.stopPropagation();
  if (!state.lockTarget) { toast('NO CONTACT TO CENTRE ON', '#ff9d8a'); return; }
  // yaw the view so the locked target sits on the crosshair
  camera.getWorldDirection(camFwd);
  var devBearing = Math.atan2(camFwd.x, camFwd.z);
  _v1.copy(state.lockTarget.wpos).sub(camera.position);
  var tgtBearing = Math.atan2(_v1.x, _v1.z);
  var delta = tgtBearing - devBearing;
  while (delta > Math.PI) delta -= Math.PI*2;
  while (delta < -Math.PI) delta += Math.PI*2;
  yawOffset += delta;
  dragYaw += delta;
  toast('CENTRED', '#8fe3ff');
});

resize();
requestAnimationFrame(frame);

})();
