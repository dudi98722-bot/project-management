with open('C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/crm_template.html','r',encoding='utf-8') as f:
    c = f.read()

# Find and replace the IIFE with credentials
start = c.find("(function(){")
end = c.find("})();", start) + 5

old_block = c[start:end]
print("Found block length:", len(old_block))
print("Contains password:", '0527695019' in old_block)

new_block = """(function(){
  var H='092ac8c9795ff2c16d3b1e8c096075cc7b8ae2758cff024b3ba6ed5e74f551dd';
  if(sessionStorage.getItem('crm_auth')==='1'){
    document.getElementById('loginScreen').style.display='none';
  }
  async function hashCreds(u,p){
    var buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(u+':'+p));
    return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  }
  window.doLogout=function(){
    sessionStorage.removeItem('crm_auth');
    location.reload();
  };
  window.doLogin=async function(){
    var eu=document.getElementById('loginUser').value.trim();
    var ep=document.getElementById('loginPass').value;
    var h=await hashCreds(eu,ep);
    if(h===H){
      sessionStorage.setItem('crm_auth','1');
      document.getElementById('loginScreen').style.display='none';
    } else {
      document.getElementById('loginError2').style.display='block';
      document.getElementById('loginPass').value='';
    }
  };
})();"""

c = c[:start] + new_block + c[end:]

with open('C:/Users/בונים ומוגנים/OneDrive/שולחן העבודה/קלוד/crm_template.html','w',encoding='utf-8') as f:
    f.write(c)

print("hash found:", '092ac8c9' in c)
print("password exposed:", '0527695019' in c)
print("Done!")
