local function mix(a, b)
  local x = (a * 31 + b) % 65521
  if x > 32000 then x = x - 1000 end
  return x
end
local function work(n)
  local acc, t = 0, {}
  for i = 1, n do
    acc = mix(acc, i)
    t[(i % 64) + 1] = acc
  end
  return acc, #t
end
print(work(150000))
