local s = "Hello, World"
print(#s, s:upper(), s:lower(), s:sub(1, 5), s:sub(-5))
print(s:find("World"), s:match("(%a+),"), s:gsub("o", "0"))
print(("ab"):rep(3, "-"), string.byte("A"), string.char(72, 105))
local parts = {}
for w in string.gmatch("one two three", "%a+") do parts[#parts + 1] = w:reverse() end
print(table.concat(parts, "|"))
print("a" .. "b" .. 1 .. 2.5, "x" < "y", tostring(nil), tonumber("0x1f"), tonumber("abc"))
