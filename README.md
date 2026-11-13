# GRID-BREAKER: NEON SIEGE

HD-2D isometric tactics roguelite (Vite + vanilla JS + Three.js). Defend the Unstable Power Core for 5 waves against drones that telegraph every attack.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

## Controls
| Input | Action |
|---|---|
| Click | select unit / confirm target |
| `1` `2` `3` | Move · Ability 1 · Ability 2 |
| `Space` | End turn (press twice if units still have orders) |
| `Tab` | Cycle units |
| `Esc` / right-click | Cancel |
| Wheel · right-drag · WASD · `F` | Zoom · pan · reset camera |
| `Backspace` | Reset turn (once per battle) |
| `M` / `H` | Mute · field manual |

## Layout
- `src/game/` — pure rules engine on plain-data state (clonable for undo + outcome previews): `GridManager` (BFS, LOS, board gen), `Entities` (units, abilities, enemy AI/intents), `CombatResolver` (damage, knockback, chain explosions, waves).
- `src/engine/` — `SceneManager` (ortho iso camera, bloom, 6-light pool, hit-stop clock, spring shake), `SpriteGenerator` (hard-coded 32x32 pixel matrices → NearestFilter textures), `BoardRenderer` (diorama + event animator), `ParticleSystem`, `SoundFX` (Web Audio synth).
- `src/ui/HUDManager.js` — DOM HUD, world tags, popups, screens.

The rules engine emits an event list per action; the renderer replays it with juice, then snaps visuals to the authoritative state.
