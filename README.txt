Tute Events Hub - Netlify version

Two passwords, set in Netlify > Site configuration > Environment variables:
  MARKETING_PASSWORD  full Hub, can edit (Jasmine, Kirstey)
  TEAM_PASSWORD       attendee briefings only, read-only (BDs)
Change a password: edit the variable, then Deploys > Trigger deploy.

Changes made with Claude:
  1. In the Hub sidebar, click "Download backup" and attach the file to your Claude chat.
  2. Claude sends back an update file.
  3. Click "Import update from Claude" and pick it. A safety backup is saved first.

public/                    the Hub page, logos, font, images, Portsmouth timetable
netlify/functions/api.mjs  saves and loads data (Netlify Blobs)
netlify/functions/seed.mjs starting data, copied from Claude (used once, on first run)
