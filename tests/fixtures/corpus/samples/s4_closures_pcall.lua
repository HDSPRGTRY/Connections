local function counter()
  local n = 0
  return function(step)
    n = n + (step or 1)
    return n
  end
end
local c = counter()
c() c(5)
print("count", c())
local ok, err = pcall(function() local t = nil; return t.x end)
print(ok, type(err))
local function risky(v) if v > 3 then error("too large: " .. v, 2) end return v end
print(pcall(risky, 9))
