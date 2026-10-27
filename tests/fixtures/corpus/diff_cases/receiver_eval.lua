local log = {}
o = {tag = "first"}
local function swap() o = {tag = "second"} return "arg" end
local function reg(...) return select("#", ...) end
function o.m(self, a) return self.tag .. ":" .. tostring(a) end
print(o:m(swap()), o.tag)
o = {tag = "x", m = function(self, a) return "m:" .. tostring(a) .. self.tag end}
local function again() o = {tag = "y", m = o.m} return 1 end
print(o:m(again()))
