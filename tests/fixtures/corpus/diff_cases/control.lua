local function find(list, want)
  for i, v in ipairs(list) do
    if v == want then return i end
  end
  return nil
end
print("found", find({4, 5, 6}, 5), find({4}, 9))
local out = {}
for i = 1, 3 do
  for j = 1, 3 do
    if j == 2 then break end
    out[#out + 1] = i .. ":" .. j
  end
end
print(table.concat(out, " "))
local n = 0
while true do
  n = n + 1
  if n >= 4 then break end
end
print("while", n)
local r = {}
repeat
  n = n - 1
  r[#r + 1] = n
until n <= 1
print("repeat", table.concat(r, ","))
for i = 10, 1, -3 do io.write(i, " ") end
print()
for x = 0, 1, 0.25 do io.write(x, " ") end
print()
for i = 1, 5 do
  if i % 2 == 0 then continue end
  io.write(i, ";")
end
print()
local function early(x)
  if x < 0 then return "neg" end
  if x == 0 then return "zero" end
  return "pos"
end
print(early(-1), early(0), early(3))
