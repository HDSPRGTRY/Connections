print(pcall(error, "direct"))
print(pcall(function() error("inner") end))
print(select("#", pcall(function() error({code = 7}) end)), type(select(2, pcall(function() error({code = 7}) end))))
local ok, e = pcall(function() local q = nil return q.field end)
print(ok, string.find(tostring(e), "field") ~= nil)
print(xpcall(function() error("xp") end, function(m) return "handled: " .. tostring(m) end))
print(xpcall(function(a, b) return a + b end, print, 2, 3))
local function lvl1() error("lvl", 1) end
print(pcall(lvl1))
local function lvl0() error("nolevel", 0) end
print(pcall(lvl0))
print(pcall(assert, false, "assert msg"))
print(select("#", pcall(function() return 1, 2, 3 end)))
local obj = {}
print(pcall(function() obj:missing() end))
