local log = {}
local function f(v) log[#log + 1] = "f" .. v return v end
local t = {}
t[f(1)] = f(2)
print("index-assign", table.concat(log, ","), t[1])
log = {}
local r = f(3) + f(4) * f(5)
print("arith", table.concat(log, ","), r)
log = {}
local function three(a, b, c) return a + b + c end
print("args", three(f(6), f(7), f(8)), table.concat(log, ","))
log = {}
local s = f(9) .. f(10)
print("concat", table.concat(log, ","), s)
local cnt = 0
local function nxt() cnt = cnt + 1 return cnt end
local tt = {}
tt[nxt()] = nxt()
print("order", tt[1], tt[2], cnt)
local obj = {n = 0}
function obj.m(self, k) self.n = self.n + k return self.n end
print("method-order", obj:m(f(11)), obj.n)
