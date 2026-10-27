local Account = {}
Account.__index = Account
function Account.new(v) return setmetatable({v = v}, Account) end
function Account:deposit(x) self.v = self.v + x return self end
function Account:get() return self.v end
local a = Account.new(10)
print("chain", a:deposit(5):deposit(1):get())
local list = {Account.new(1), Account.new(2)}
print("index", list[2]:get(), list[1]:deposit(9):get())
local holder = {acct = a}
print("field", holder.acct:get())
print("string", ("abc"):upper(), ("x"):rep(3))
local s = "hello world"
print("strm", s:sub(1, 5), s:find("world"), #s:upper())
local function make() return a end
print("call-recv", make():get())
local m = a.get
print("noself", m(a))
print("nested", a.get(a), a:get())
