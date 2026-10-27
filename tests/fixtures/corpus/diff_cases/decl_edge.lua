local M = {sub = {}}
function M.sub.f(x) return x + 1 end
function M.sub:g(x) return self == M.sub and x or -1 end
print(M.sub.f(1), M.sub:g(2), M.sub.g(M.sub, 3))
local Obj = {}
function Obj.new() return setmetatable({}, {__index = Obj}) end
function Obj.hello(self) return "hi" end
print(Obj.new():hello())
local counter = {n = 0}
function counter.step(by) counter.n = counter.n + (by or 1) return counter.n end
print(counter.step(), counter.step(4))
