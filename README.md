# Operation Skyline — AR Strike

An augmented-reality strike game for iPhone and iPad. It runs entirely in Safari:
the rear camera is the backdrop, and a battlefield of enemy installations, armour
columns, buildings, forests and lakes is rendered over it, anchored to the horizon
by the device's motion sensors.

**Play:** https://akshaybangalorekar.github.io/aero-strike/

Open that link in Safari on an iPhone or iPad, tap START MISSION and allow camera
and motion access. HTTPS is required for both, which is why it is served from Pages.

## Controls

- **Aim** — move the device. Whatever the crosshair rests on is locked.
- **FIRE** — launch a guided missile from the orbiting air wing. Unlimited supply; hold to salvo.
- **Tap a target** — pin the lock to that specific contact.
- **◎** — snap the nearest contact onto the crosshair.

## What is simulated

Missiles fly under gravity (9.81 m/s²), quadratic drag and engine thrust, with a hard
limit on lateral acceleration, so they genuinely overshoot if launched at a bad angle.
Hit detection is swept rather than point-sampled, so a fast missile cannot tunnel
through a small target. Blast damage falls off with distance, which is what makes
chain reactions through a convoy possible.

Enemy command posts fire tracers at the air wing; jets can be shot down and are
replaced after six seconds.

## Files

| file | purpose |
|---|---|
| `index.html` | page shell, HUD styling and markup |
| `game.js` | simulation, rendering and input |
| `three.min.js` | three.js r160, bundled so the game needs no CDN |

Everything is plain static files — no build step, no dependencies to install.
