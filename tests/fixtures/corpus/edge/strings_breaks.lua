local a = [[
x\y"z
w]]
local b = [==[p]]q
r]==]
local c = "q\
r"
local d = "s\z     t"
local e = 'single'
local f = [[tab	here
end]]
print(#a, a)
print(#b, b)
print(#c, c, #d, d, #e, e)
print(#f, f)
