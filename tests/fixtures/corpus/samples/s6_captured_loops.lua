local total = 0
local function make(limit)
  local hits = 0
  return function(step)
    hits = hits + 1
    total = total + step
    if hits >= limit then return nil end
    return hits
  end
end
local f = make(4)
local i = 0
while true do
  i = i + 1
  local r = f(i)
  if r == nil or i > 10 then break end
end
for k = 10, 1, -3 do total = total + k end
print("total", total, "i", i)
