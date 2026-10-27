local t = {}
for i = 1, 600000 do t[i] = {id = i, v = i * 2, tag = "x"} end
local s = 0
for i = 1, #t do
  local r = t[i]
  s = (s + r.id + r.v) % 1000003
  r.v = r.v + 1
end
local nested = {a = {b = {c = 0}}}
for i = 1, 600000 do nested.a.b.c = nested.a.b.c + (i % 7) end
print("tables", s, nested.a.b.c)
