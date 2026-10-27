local Vec = {}
Vec.__index = Vec
function Vec.new(x, y) return setmetatable({x = x, y = y}, Vec) end
Vec.__add = function(p, q) return Vec.new(p.x + q.x, p.y + q.y) end
Vec.__eq = function(p, q) return p.x == q.x and p.y == q.y end
Vec.__tostring = function(p) return "(" .. p.x .. ", " .. p.y .. ")" end
Vec.__call = function(p, k) return p[k] end
function Vec:len2() return self.x * self.x + self.y * self.y end
local v = Vec.new(1, 2) + Vec.new(3, 4)
print(tostring(v), v:len2(), v == Vec.new(4, 6), v("x"))
local defaults = setmetatable({}, {__index = function(_, k) return "default_" .. k end})
print(defaults.color, rawget(defaults, "color"))
local log = {}
local proxy = setmetatable({}, {__newindex = function(t, k, val) rawset(t, k, val * 2); log[#log + 1] = k end})
proxy.a = 5
print(proxy.a, #log)
