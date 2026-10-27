-- a small class with methods and field access
local Account = {}
Account.__index = Account
function Account.new(owner, balance)
  local self = setmetatable({}, Account)
  self.owner = owner
  self.balance = balance or 0
  return self
end
function Account:deposit(amount)
  if amount <= 0 then error("invalid amount", 2) end
  self.balance = self.balance + amount
end
function Account:report()
  return string.format("%s has %d", self.owner, self.balance)
end
local a = Account.new("alice", 10)
a:deposit(5)
print(a:report())
