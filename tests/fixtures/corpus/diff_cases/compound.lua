local t = {x = 1, n = {m = 2}, arr = {5, 6}}
t.x += 5
t.n.m -= 1
t.x *= 2
t.arr[2] /= 4
print(t.x, t.n.m, t.arr[2])
local i = 0
local function idx() i = i + 1 return i end
local c = {0, 0}
c[idx()] += 10
print("once", c[1], c[2], i)
local s = "a"
s ..= "b"
print(s)
local p = 2
p ^= 3
p %= 5
print(p)
