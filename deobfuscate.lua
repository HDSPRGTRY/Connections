-- Deobfuscation script for educational purposes
-- This demonstrates how to reverse the obfuscation techniques

local hex = "525d5ac02b2033c756d20b4be77b5450df97a28765e6634f619d1a33a4b473dca0fc5c93c14b3746ba5c7829eea0e0821f5a2d8a42249baa89c6d080991f2a4ac54efd4406b25d78e4cb2fe0bd23be5274549aef52e2f57cee89f0a8752f6a96ba3df248fc51db6109b2b5749080e2dc12c1661cac43842321c60f285017148b8e4f200ea7c5e9ae84898ac203f9f236903dd2627f2489974d8f790dae29934b0e8fa34ef22657185b2fc7bb768f0c356665eacc566ab8f0d77e4266df14840797d5ec8d3fccf83ff395c1a9ee367814a98899eebbf63b8188f7b5b07a201c96197b42ad56090d93b5edba970c875c477e741ec5726d00d31e8fdd5ecdc51ac4d08891976d1609b796067d5f189656425c4949da31ec15118d37dc75272b23c0"

local k1 = 43400
local k2 = 33406
local k3 = 177
local rounds = 5

-- Inverse S-box from the obfuscated code
local inv_sbox = {82,9,106,213,48,54,165,56,191,64,163,158,129,243,215,251,124,227,57,130,155,47,255,135,52,142,67,68,196,222,233,203,84,123,148,50,166,194,35,61,238,76,149,11,66,250,195,78,8,46,161,102,40,217,36,178,118,91,162,73,109,139,209,37,114,248,246,100,134,104,152,22,212,164,92,204,93,101,182,146,108,112,72,80,253,237,185,218,94,21,70,87,167,141,157,132,144,216,171,0,140,188,211,10,247,228,88,5,184,179,69,6,208,44,30,143,202,63,15,2,193,175,189,3,1,19,138,107,58,145,17,65,79,103,220,234,151,242,207,206,240,180,230,115,150,172,116,34,231,173,53,133,226,249,55,232,28,117,223,110,71,241,26,113,29,41,197,137,111,183,98,14,170,24,190,27,252,86,62,75,198,210,121,32,154,219,192,254,120,205,90,244,31,221,168,51,136,7,199,49,177,18,16,89,39,128,236,95,96,81,127,169,25,181,74,13,45,229,122,159,147,201,156,239,160,224,59,77,174,42,245,176,200,235,187,60,131,83,153,97,23,43,4,126,186,119,214,38,225,105,20,99,85,33,12,125}

-- Hex to bytes conversion
local function hex_to_bytes(h)
    local r = {}
    for i = 1, #h, 2 do
        r[#r+1] = tonumber(h:sub(i,i+1), 16)
    end
    return r
end

-- Inverse ShiftRows
local function inv_shift_rows(b)
    local t = b[1]; b[1] = b[13]; b[13] = b[9]; b[9] = b[5]; b[5] = t
    t = b[2]; b[2] = b[10]; b[10] = t
    t = b[3]; b[3] = b[7]; b[7] = b[11]; b[11] = b[15]; b[15] = t
    return b
end

-- Inverse MixColumns
local function inv_mix_columns(b)
    for j = 0, 3 do
        local i = j * 4
        local a = b[i+1]
        local d = b[i+4]
        b[i+1] = (a ~ d) % 256
        b[i+2] = (a ~ b[i+2]) % 256
        b[i+3] = (b[i+3] ~ d) % 256
    end
    return b
end

-- Inverse SubBytes using inverse S-box
local function inv_sub_bytes(b, k)
    for i = 1, 16 do
        b[i] = inv_sbox[(b[i] ~ (k & 0xFF)) % 256 + 1]
    end
    return b
end

-- Main decryption function
local function decrypt(h, k1, k2, k3, rounds)
    local b = hex_to_bytes(h)
    local r = rounds or 4

    for n = r-1, 0, -1 do
        local rk = (k1 + n * k2) ~ k3

        -- Inverse AddRoundKey
        for i = 1, 16 do
            b[i] = (b[i] ~ ((rk >> ((i-1) % 8)) & 0xFF)) % 256
        end

        b = inv_mix_columns(b)
        b = inv_shift_rows(b)
        b = inv_sub_bytes(b, rk)
    end

    local s = ""
    for i = 1, 16 do
        s = s .. string.char(b[i])
    end
    return s
end

-- Decrypt the hex string
local decrypted = decrypt(hex, k1, k2, k3, rounds)
print("Decrypted string:")
print(decrypted)
