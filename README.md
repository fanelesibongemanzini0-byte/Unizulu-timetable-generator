
this website help students/lectures generate personalized timetables 
# UniZulu Personal Timetable Builder

A small full-stack app that reads live timetable data from
`mycelcat.unizulu.ac.za` (the university's public CELCAT Web Publisher) and
lets a student pick their modules to generate a personal weekly timetable,
with clash detection.

## How it works

- `mycelcat.unizulu.ac.za/finder.xml` is a public XML list of every module.
- `mycelcat.unizulu.ac.za/m{id}.xml` is the public XML timetable for one
  module (day, time, room, active teaching weeks).

Both are meant to be machine-readable (they ship with an XSLT stylesheet),
so the server just fetches and parses XML — no login, no browser automation.

## Setup

```bash
npm install
npm start
```

Then open http://localhost:3000

## API

- `GET /api/modules?q=marketing` — search modules by code/title/department
- `POST /api/refresh` — force-refresh the cached module list
- `POST /api/timetable` — body `{ "moduleIds": ["7462", "7488"] }` returns
  merged events + any detected clashes

## Notes / things to double check before relying on this

- **Semester changes**: the finder shows whatever semester is currently
  published (e.g. `Class_TT_Semester2_2026`). When the university publishes a
  new semester, module IDs can change — just hit `/api/refresh` (or restart
  the server, since the cache expires hourly anyway).
- **Clash detection** compares day + time + overlapping "active weeks" for
  events between *different* modules. It ignores overlaps within the same
  module (e.g. lecture + tutorial back to back is normal).
- **Rate limiting**: this fetches one XML page per selected module. Fine for
  personal/small-scale use; add caching per-module if you expect heavy
  traffic, to be polite to the university's server.
- **Deployment**: this is a plain Node/Express app — deployable as-is to
  Render, Railway, Fly.io, a VPS, etc. Set `CELCAT_BASE_URL` env var if the
  university ever moves the CELCAT instance to a new URL.
