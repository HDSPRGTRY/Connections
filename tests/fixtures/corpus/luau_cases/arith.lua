local a, b = 17, 5
print(a + b, a - b, a * b, a / b, a % b, a // b, a ^ 2)
print(math.floor(a / b), math.max(a, b, 3), math.min(a, b), math.abs(-a))
print(string.format("%d %5.2f %s", a, a / b, "ok"))
print(1e3, 0x10, 3.0 == 3, 7 ~= 8, -(-a))
local t = 0
for i = 1, 10 do t = t + i * i end
print(t)
