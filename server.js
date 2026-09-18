const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');

// Express server for Render health checks
const app = express();
app.use(express.json()); // Parse JSON request bodies
app.get('/', (req, res) => res.send('Discord Bot Running'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

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
    console.log('GET /states received');
    const states = {};
    userStates.forEach((value, key) => {
        states[key] = value.data;
    });
    console.log('Returning states:', Object.keys(states));
    res.json(states);
});

// API endpoint to get specific user state
app.get('/state/:username', (req, res) => {
    console.log(`GET /state/${req.params.username} received`);
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
    
    const existingState = userStates.get(username);
    
    // Store user state in memory
    userStates.set(username, {
        message: existingState ? existingState.message : null,
        data: data
    });
    
    console.log(`State stored for ${username}`);
    
    // If we have a Discord channel, also update there
    if (CHANNEL_ID && client.readyAt) {
        const channel = client.channels.cache.get(CHANNEL_ID);
        if (channel) {
            if (existingState && existingState.message) {
                // Edit existing message
                existingState.message.edit(JSON.stringify(data))
                    .then(msg => {
                        userStates.set(username, { message: msg, data: data });
                        console.log(`Discord message edited for ${username}`);
                    })
                    .catch(err => console.error('Error editing message:', err));
            } else {
                // Send new message
                channel.send(JSON.stringify(data))
                    .then(msg => {
                        userStates.set(username, { message: msg, data: data });
                        console.log(`Discord message sent for ${username}`);
                    })
                    .catch(err => console.error('Error sending message:', err));
            }
        }
    }
    
    res.json({ success: true });
});

client.login(BOT_TOKEN);
