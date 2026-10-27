local base = 100
local function pick(a, b, ...)
  return a, b, base, select("#", ...), ...
end
print(pick(1))
print(pick(1, 2, 3, 4))
print(pick(1, 2, nil, nil))
local function total(...)
  local s = base
  for _, v in ipairs({...}) do s = s + v end
  return s
end
print(total(), total(1), total(1, 2, 3))
