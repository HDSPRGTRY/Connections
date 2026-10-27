local function count(...) return select("#", ...) end
local function pass(...) return ... end
print(count(), count(nil), count(1, nil, 3), count(pass(1, 2, 3)))
local packed = table.pack(1, nil, 3)
print(packed.n, packed[3])
print(table.unpack({10, 20, 30}, 2))
local function sum(...)
  local total = 0
  for i = 1, select("#", ...) do total = total + (select(i, ...)) end
  return total
end
print(sum(1, 2, 3, 4), (pass(7, 8)))
local a, b, c = (function() return 1, 2 end)()
print(a, b, c)
