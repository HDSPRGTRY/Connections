local out = {}
for i = 10, 1, -3 do out[#out + 1] = i end
print(table.concat(out, " "))
local n, steps = 27, 0
while n ~= 1 do
  if n % 2 == 0 then n = n // 2 else n = 3 * n + 1 end
  steps = steps + 1
end
print("collatz steps", steps)
local r = 0
repeat r = r + 3 until r > 10
print(r)
for i = 1, 6 do
  if i % 2 == 0 then continue end
  if i > 4 then break end
  io_marker = i
  print("odd", i)
end
for i = 1, 3 do
  for j = 1, 3 do
    if j == 2 then break end
    print(i, j)
  end
end
