local function count(...) return select("#", ...) end
print("count", count(), count(nil), count(1, nil, 3))
local function pass(...) return ... end
print("pass", pass(1, 2, 3))
print("middle", pass(1, 2, 3), "end")
local function pack2(...) local t = {...} return #t, t[1], t[2] end
print("pack2", pack2(7, 8))
local function tp(...) local t = table.pack(...) return t.n end
print("tp", tp(nil, nil))
local function mr() return 1, 2, 3 end
local x, y, z, w = mr()
print("assign", x, y, z, w)
local t2 = {mr(), mr()}
print("ctor", #t2)
local t3 = {mr(), (mr())}
print("paren", #t3)
local function va(...) local a, b = ... return a, b end
print("va", va(9, 8, 7))
print("select", select(2, "a", "b", "c"))
print(select(-1, "a", "b", "c"))
