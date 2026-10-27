-- simple numeric helpers
local function add(a, b) return a + b end
local function scale(x, factor)
  if factor == nil then factor = 2 end
  return x * factor
end
print(add(3, 4), scale(5), scale(5, 10))
