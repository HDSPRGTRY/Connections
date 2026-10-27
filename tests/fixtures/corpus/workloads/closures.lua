local base = 7
local count = 0
local function scale(v) return v * base end
local function bump() count = count + 1 return count end
local function make(k) return function(x) return x + k end end
local add5 = make(5)
local s = 0
for i = 1, 2000000 do
  s = (s + scale(i) + add5(i)) % 1000003
  if i % 1000 == 0 then bump() end
end
print("closures", s, count)
