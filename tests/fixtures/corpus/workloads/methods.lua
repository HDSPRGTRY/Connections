local Counter = {}
Counter.__index = Counter
function Counter.new() return setmetatable({n = 0, step = 3}, Counter) end
function Counter:add(k) self.n = self.n + k * self.step return self end
function Counter:get() return self.n end
local c = Counter.new()
for i = 1, 300000 do c:add(i % 5) end
print("methods", c:get() % 1000003)
