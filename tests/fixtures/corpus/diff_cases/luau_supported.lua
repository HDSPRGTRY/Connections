local x: number = 5
local name: string = "typed"
local list: {number} = {1, 2, 3}
print(x, name, #list)
for i = 1, 3 do
  if i == 2 then continue end
  print("c", i)
end
local t = {n = 1}
t.n += 4
print(t.n)
