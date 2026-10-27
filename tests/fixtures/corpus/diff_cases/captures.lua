local count = 0
local label = "L"
local function bump() count = count + 1 return count end
local function show() return label .. count end
print(bump(), bump(), show())
label = "M"
print(show())
local function readOnly() return label end
print(readOnly())
local base = 3
local function scale(v) return v * base end
print(scale(2), scale(5))
local acc = {}
local function push(v) acc[#acc + 1] = v return #acc end
print(push("a"), push("b"), acc[1], acc[2])
local function viaOther() bump() return count end
print("via other", viaOther())
local a, b = 1, 2
local function sum() return a + b end
local function setA() a = 10 end
print(sum())
setA()
print(sum())
