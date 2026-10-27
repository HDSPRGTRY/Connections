local s = [[line one
line two]]
--[==[ block
comment ]==]
local t = "tab\tq\"x"  -- trailing comment
print(#s, s:sub(1, 8), t)
local u = "a\
b"
print(u, [==[x]]y]==])
