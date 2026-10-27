local x = 1
do
  local x = x + 10
  print("inner", x)
  do
    local x = x * 2
    print("innermost", x)
  end
  print("after innermost", x)
end
print("outer", x)
local function f(x) local x = x + 1 return x end
print("param shadow", f(4), x)
for x = 1, 2 do print("loop", x) end
print("after loop", x)
local t = {}
for i = 1, 3 do local v = i * i t[i] = function() return v end end
print("closures", t[1](), t[2](), t[3]())
