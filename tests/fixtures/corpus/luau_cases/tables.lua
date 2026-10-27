local t = {5, 3, 9, 1}
table.insert(t, 7)
table.insert(t, 1, 0)
print(#t, table.concat(t, ","))
print(table.remove(t), table.remove(t, 1), #t)
table.sort(t, function(x, y) return x > y end)
print(table.concat(t, " "))
local map = {beta = 2, alpha = 1, gamma = 3}
local keys = {}
for k in pairs(map) do keys[#keys + 1] = k end
table.sort(keys)
for _, k in ipairs(keys) do io_out = nil; print(k, map[k]) end
print(select("#", nil, nil), next({}) == nil)
local nested = {a = {b = {c = "deep"}}}
print(nested.a.b.c, rawget(nested, "a") ~= nil)
