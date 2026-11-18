# Tute Events Hub: changes waiting to go live

Last updated 14 Oct 2026. Everything below is built and tested, and included in this pack. It goes live in one deploy.

## How to deploy (one go)
1. Download a backup from the live Hub first (Toolkit → Download backup).
2. In GitHub, replace `public/index.html` and `functions/api.mjs` with the ones in this pack. Nothing else needs to change.
3. Netlify deploys automatically. Sign in and check: Marketing workspace, BD page, one upload.
4. After the deploy, open Schools & Academies Show → Briefing setup → Key contacts and clear "Other contacts". They now live in the Event contacts list, so they would otherwise show twice.

## BD team page
- "Briefings" tab renamed **Upcoming events**. Every booked event shows in date order, even with no attendees yet.
- Briefings only open once Marketing shares them (Briefing setup → Share with BD team). The rest say "Briefing coming soon".
- Event cards show the audience (settings and phase) and the event logo.
- New **Event feedback** tab: post-event form (rating, go again?, audience, footfall, all leads, qualified leads (MQLs), meetings, opportunities, D365, best leads, what worked, what to change, competitors, kit).

## Marketing workspace
- **Edit everything**: Edit buttons on Overview summary, Logistics, Stand/Stall, Lead capture and Merchandise; add/edit/delete assets; total budget in Edit event details.
- **Required fields** marked * per event type (exhibition vs conference), "n to add" tags on each tab, and an **Event record** checklist on the Overview.
- **Audience**: settings, phase and roles on every event.
- **Event contacts**: organiser, account manager, operations, finance, H&S, contractor, venue, suppliers. Each marked "In briefing" or "Marketing only" (finance and sales contacts are never sent to the BD page).
- **Uploads**: stand render or photo, floorplan, event logo, asset artwork, and an Images and files list (timetables, maps) that can show in the briefing.
- **Pipeline**: edit any row and add new events directly.
- **Results**: BD feedback summary and "Fill results from feedback"; leads split into all leads and qualified leads (MQLs).
- **Merch: where the stock is**: office, each BD and suppliers, with New stock arrived, Move stock, Update count, Used and Returned to office buttons, plus a log of moves. Totals add up from these, and the event columns only show upcoming events, tabbed by term.
- Wording: "badge scanner" instead of SmartScan, except where an event used SmartScan.
- The "activation to confirm" warning only shows for scanner apps, not paper forms.
- **Standard briefing for small conferences**: any conference or table-stall event uses the template's standard wording (what to bring, lead forms, set-up steps, leftovers, lead handover) wherever its own field is empty, so only the location, focus, audience and times need filling in. The wording is data: tute-events-hub-update-conference-defaults.json.
- **Videos and files under “Bring with you”**: a new briefing field for links the team must have ready (like the Tute lesson video), shown as a button right under the Bring with you list. Until then those links sit at the bottom of Show information.
- **Fix: Results lead list and D365 notes**: what you type or paste into “Lead list” and “Leads in D365” on the Results tab saves, but the box shows empty again. Fixed so they display.
- **Fix: long stand details in the briefing** wrap onto a new line instead of running into the next column.
- **BD team view only shows ready briefings**: events appear for the BD team only once Marketing marks the briefing as shared (no more “coming soon” cards, and approving an event no longer puts it in front of the team).
- **Map tab (to build)**: England map with a pin per city, counts by North / Central / South, term filters, and the team view filtered by region. It reads each event's region field. Until then, the separate Tute Events Map page does this.

## Data already sent as update files (import any time, no deploy needed)
- tute-events-hub-update-saas26.json: Schools & Academies Show details and tasks
- tute-events-hub-update-saas26-leads.json: lead capture fixes
- tute-events-hub-update-audience.json: audience for every event, badge scanner wording
- tute-events-hub-update-saas26-contacts.json: S&A contacts (visible after deploy)
- tute-events-hub-update-stock.json: opening merch counts (office 0, Paula 12/37/18, CSD to count) · shows after deploy
- tute-events-hub-update-education-people-show.json: Education People Show booking details, logistics, lead app, advert asset, contacts (contacts visible after deploy)

- tute-events-hub-update-conference-defaults.json: the standard small-conference briefing wording (used automatically after the deploy)
- tute-events-hub-update-regions.json: adds North / Central / South to every event, ready for the Map tab

Do not import the older tute-events-hub-update-sharing-and-ashe.json. It would undo later ASHE edits.

## After the deploy
- Upload the floor plans (Images and files): Tes SEND North 2027 sales plan (stand F2) and ASCL 2027 floor plan (stand 5)
- Upload the S&A render properly (it's currently stored inside the event record)

## Still open
- ASHE: real date (19 Nov) and booking status "Booked"
- Education People Show: check the badge passes and H&S form went in (due 9 Oct); company info and logo form (ASAP); Event Guide advert specs and deadline; what kit and merch goes and how it gets there
- S&A: summary and objective
- Westminster Insight: attendee, contacts and details
