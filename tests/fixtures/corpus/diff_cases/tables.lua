local k = "dyn"
local t = {1, 2, x = 3, [k] = 4, ["plain"] = 5, [10] = 6, nested = {a = {b = "deep"}}}
print(t[1], t[2], t.x, t.dyn, t.plain, t[10], t.nested.a.b, t["nested"]["a"]["b"])
local function three() return 7, 8, 9 end
local u = {three(), x = three(), three()}
print(#u, u[1], u[2], u[3], u.x)
local v = {[1 + 1] = "two", [#u] = "last"}
print(v[2], v[#u])
t.x = nil
print("nil", t.x, t[10])
local w = {}
w.a = {}
w.a.b = {}
w.a.b.c = 42
print("deep", w.a.b.c, w["a"]["b"]["c"])
local m = setmetatable({}, {__index = function(_, key) return "idx:" .. key end})
print("meta", m.anything, m["other"])
rawset(m, "raw", 1)
print("raw", m.raw)
