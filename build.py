import os,shutil
r=lambda p:open(p,encoding="utf-8").read()
html=r("src/shell.html").replace("/*__CSS__*/",r("src/style.css")).replace("/*__JS__*/",r("src/app.js"))
os.makedirs("public",exist_ok=True);open("public/index.html","w",encoding="utf-8").write(html)
open("gas/Index.html","w",encoding="utf-8").write(html)
for a,b in [("shared/core.js","gas/Core.gs"),("shared/examdata.js","gas/Examen.gs"),("shared/pdf.js","gas/PDF.gs")]: shutil.copy(a,b)
print("build OK",len(html)//1024,"KB")
