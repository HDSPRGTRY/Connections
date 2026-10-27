local Stack = {}
Stack.__index = Stack
function Stack.new() return setmetatable({items = {}, n = 0}, Stack) end
function Stack:push(...)
  for _, v in ipairs({...}) do
    self.n = self.n + 1
    self.items[self.n] = v
  end
  return self.n
end
function Stack:pop()
  if self.n == 0 then return nil end
  local v = self.items[self.n]
  self.items[self.n] = nil
  self.n = self.n - 1
  return v
end
local s = Stack.new()
s:push(1, 2, 3)
print(s:pop(), s:pop(), s.n, select("#", 4, 5, 6))
