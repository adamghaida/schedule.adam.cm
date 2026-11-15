# CMU-Q Schedule Planner

An unofficial schedule planner for Carnegie Mellon University in Qatar. Add the
courses you are taking and the course list narrows to what still fits around
them. It is a plain static site: four files, no build step, no server, no
accounts.

Live at https://schedule.adam.cm

## What it does

- **Add a course, watch the list shrink.** Every course that clashes with your
  schedule drops out of the "Still fits" list. The "Clashes" tab shows what
  dropped out and which of your courses it collides with.
- **Maybes.** Park courses you are still deciding on. They show dashed on the
  week grid, do not narrow the list, and the planner tells you which maybes fit
  and which combinations of them work together.
- **Plans.** Copy a plan to try a different mix (Plan A, Plan B, …).
- **Sections.** A course with several sections stays on "Any section" until you
  pin one, so a course still counts as fitting if moving another course to a
  different section makes room.
- **Minis.** Mini 1 and Mini 2 (or 3 and 4) run in different halves of the
  semester, so they can share a time slot.
- **Prerequisites (optional).** Paste a transcript, an audit, or a plain list of
  course numbers. Each course then shows whether you meet its prerequisites,
  and you can filter to courses you can take. Without a list the planner works
  the same, minus those labels.
- **Blocked time.** Add work, commute, or anything else that takes up a slot.
- **Bulk add.** Paste several course numbers into the search box to add them
  in one go.

Plans are saved in the visitor's own browser (`localStorage`). Nothing is sent
anywhere.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 4173
```

Then visit http://localhost:4173.

## Host it

Upload these four files to any static host, keeping them side by side:

```
index.html
styles.css
app.js
data.js
```

- **GitHub Pages:** push this folder to a repository, then Settings → Pages →
  Deploy from a branch → `main` / root.
- **Netlify or Cloudflare Pages:** drag the folder onto their dashboard, or
  connect the repository. Build command: none. Publish directory: the folder
  itself.
- **Vercel:** import the repository with the "Other" framework preset and no
  build command.
- **An existing site:** copy the folder in as a subdirectory, for example
  `yoursite.com/schedule/`. All paths are relative, so it works from any path.

`scripts/` and this README are not needed on the server.

This copy is served by GitHub Pages from the `main` branch. The `CNAME` file
sets the custom domain and `.nojekyll` tells Pages to serve the files as they
are. Pushing to `main` redeploys.

## Refresh the schedule data

`data.js` is generated from CMU's public
[Schedule of Classes](https://enr-apps.as.cmu.edu/open/SOC/SOCServlet/search),
filtered to Doha. Regenerate it whenever the schedule changes, and at the start
of each registration period:

```bash
python3 scripts/update_data.py
```

With no arguments it takes the two newest non-summer semesters. To choose:

```bash
python3 scripts/update_data.py S27 F26
```

The first semester listed is the one the planner opens on. It needs Python 3.8+
and nothing else. A run makes about 160 small requests per semester and takes a
minute or two. Commit the new `data.js` and redeploy.

## What it does not know

- Seats, waitlists, reservations, and instructor permission. A course that
  "fits" may still be full or restricted.
- Instructors and rooms. The public schedule does not list them.
- Grades. The prerequisite check treats every course number in your list as
  passed.
- Exact dates for micro courses. They are treated as running for their whole
  mini.

Always confirm in SIO before you register. This project is not affiliated with
or endorsed by Carnegie Mellon University.
