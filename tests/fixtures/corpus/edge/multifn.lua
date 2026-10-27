local function add(a, b) return a + b end
local Counter = {}
Counter.__index = Counter
function Counter.new() return setmetatable({ n = 0 }, Counter) end
function Counter:inc(k) self.n = self.n + (k or 1) return self end
local c = Counter.new():inc():inc(5)
print(add(2, 3), c.n)
for i = 1, 3 do print(i, add(i, i)) end
