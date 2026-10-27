local parts = {}
for i = 1, 200000 do parts[#parts + 1] = string.format("%d:%s", i, "v") end
local joined = table.concat(parts, ",")
local count = 0
for _ in string.gmatch(joined, "%d+") do count = count + 1 end
local up = string.upper(string.sub(joined, 1, 200))
print("strings", #joined, count, up:sub(1, 12))
