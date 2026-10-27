GAME_VERSION = "1.4.2"
local function describe(name)
  return name .. " @ " .. GAME_VERSION
end
local key = "srv" .. "key"
local ok = _G[key] == nil
print(describe("client"), ok, math.floor(7.9), tostring(12))
