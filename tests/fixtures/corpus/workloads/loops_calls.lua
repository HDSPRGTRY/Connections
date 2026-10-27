local function step(a, b) return (a * 31 + b) % 1000003 end
local function mix(x, y, z) return step(x, y) + step(y, z) end
local acc = 0
for i = 1, 3000000 do
  acc = (acc + mix(i, i + 1, i + 2)) % 1000003
end
print("loops_calls", acc)
