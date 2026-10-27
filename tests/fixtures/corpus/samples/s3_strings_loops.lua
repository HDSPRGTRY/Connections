local secret = "launch-code-7731"
local function checksum(s)
  local h = 0
  for i = 1, #s do h = (h * 31 + string.byte(s, i)) % 65521 end
  return h
end
local words = {"alpha", "beta", "gamma"}
for i, w in ipairs(words) do
  print(i, w, checksum(w), w:upper())
end
print("token", checksum(secret))
