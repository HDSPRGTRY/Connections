# MM2 Inventory API - Additional Notes

## What Was Added

### server.js
Added the following endpoints to your existing server:
- `GET /api/inventory` - Get all inventory data
- `GET /api/inventory/:username` - Get specific user's inventory
- `POST /api/inventory` - Receive inventory data from MM2 script
- `DELETE /api/inventory/:username` - Clear specific user's inventory
- `DELETE /api/inventory` - Clear all inventory data

These endpoints are marked with `⚠️ ADDED: MM2 Inventory API` comments in the code.

### public/inventory.html
New file for viewing inventory data in a web interface.

### README.md
Added a section at the bottom documenting the new inventory API.

---

## How It Works Together

Your server now handles BOTH:
1. **Original:** Discord bot for weapon sync (uses Discord API)
2. **New:** Inventory API for MM2 script (uses in-memory storage)

Both run on the same server without conflicts.

---

## Deployment

No changes needed to your deployment process. The same environment variables work:
- `BOT_TOKEN` - For Discord bot
- `CHANNEL_ID` - For Discord sync channel

The inventory API doesn't require additional environment variables.

---

## Usage

### For Weapon Sync (Original)
Your game scripts send data to `/state/:username` and Discord syncs it.

### For Inventory (New)
The MM2 elysium script sends data to `/api/inventory` and the web interface displays it.

Both can be used simultaneously.
