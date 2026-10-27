local total = 0
for i = 1, 5 do total += i end
total -= 3
total *= 2
print(total)
local s = "a"
s ..= "b"
print(s)
local grade = function(score)
  if score >= 90 then return "A"
  elseif score >= 80 then return "B"
  else return "C" end
end
print(grade(95), grade(85), grade(10))
local flag = not (1 > 2) and (2 >= 2 or false)
print(flag, nil == false, 0 and "zero is true")
