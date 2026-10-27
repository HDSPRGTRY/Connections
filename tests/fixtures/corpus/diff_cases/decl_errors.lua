print(pcall(function() function nope.f() end end))
local base = {}
function base.a() return "a" end
function base.sub() return "sub" end
print(base.a(), base.sub())
print(pcall(function() local q = nil; function q.f() end end))
