#!/usr/bin/env python3
"""Offline, test-only real financial source archives and certificates.

Only transport bodies and clocks are synthetic. The pinned yfinance normalizer,
collector, immutable archive merger, source certifier, schemas and destination
projectors are production code. Independent socket/curl guards block networking.

Staged CLI avoids the source-request/certifier Git commit hash cycle::

    python build-financial-renewal-source.py sources --output DIR --config FILE
    python build-financial-renewal-source.py certify --source ROOT --output DIR --config FILE
    python build-financial-renewal-source.py project --source ROOT --output DIR --config FILE

The sources config requires source_head_sha. Optional base_path supplies exact
base bytes; otherwise a minimal two-stock base is used. Optional generations
replaces the three default generations. Each entry accepts name, evaluated_at,
base_path or as_of_date, selected, previous, and source run/artifact/job IDs.
expired_variant adds a branch renewing AMD while untouched NVDA has expired.

The certify config requires certifier_code_root and certifier_code_sha; its
optional reference object supplies certificate run_id/run_attempt/job_id and
artifact_id. Exact source paths and evaluation time default to source.json next
to the supplied source root. The project config accepts target_base_path,
target_publication_identity and evaluated_at. All commands print one JSON result.
No provider, GitHub, package install, Git mutation or publication is performed.
"""
from __future__ import annotations

import argparse
import base64
from contextlib import ExitStack
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from hashlib import sha1, sha256
import importlib.util
import json
from pathlib import Path
import re
import shutil
import socket
import sys
from unittest.mock import patch
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "backend"))

# Exact reviewed production bytes fetched read-only from this branch. These five
# files are absent from the release checkout; the other reviewed files are copied
# only after both SHA-256 and Git-blob verification. This is fixture data, never
# written to the production checkout. Hashes are bound by the existing trust file.
CERTIFIER_ORIGIN = {
    "repository": "kusennjp1-ai/screener",
    "ref": "preview/financial-source-certification",
    "trust_path": "contracts/financial_source_certification_trust_v1.json",
}
EMBEDDED_CERTIFIER = {
    'backend/app/services/statement_source_certification.py': (
        'c-pmn`*Rz|k?`;QEB5xPE`SY!lp^OoBf(YCG9Bw;ODc)ZCE=mAmcW8s3$N?~l4u?O_pcw*Gd+(5K-'
        'o#9EO2%nJu^N1o}N6<zgh2Avuc*D=krCqs<LU-Z0mVFEw}Z01*KW_v7BzRO|zcu;9FMWXDDe0*{XVv1=D}-'
        '>bAz}!;_PXtldqgRol*Y3)NSZm2C@uwOPH|R<}*Pz0b<kENiOGqP)-6tHu2=dx67LQ0;xyX7jRMRI?L1?sUDHE_N-'
        '90wY7|`+5eYH;eW39TY6<wyjsU*}Se6vzEGEH}!43Di>M1-'
        'ZfL07*!pfz$nvlwOVhpa<{#MTEA4;W_PnNQyyex)^4F{_Rn3pP%F`7^IfyOgF)@+AJ)yg;Ypt7C-'
        'Y{#%!*>Z+wPjGD6)FFSvN2OjzjI+6RtB|FBa95N~F?r*nw@;$oI{?e3(_$2LC=WfB)RBS6pjTZtoWLjZ}OMe-'
        '5(OF!bwnTYtnqrA<@GuNDB2-`i@rnZx>WZ`=D#Wuf_Qw<7Sapirv+QgdytK9s6+Sl-pNE*Ay%T`jBCwzw&`(>vJgjD7?STs6TW_%'
        'Xe!-'
        'y?ct=BH_+I;Z_BDqQmwY@`7C;^oE5=PxdPD874f`NOww2if`tafg<>sAq%hJ?!5MMl7n;`)aX<`JB9Y_3A1c(}MM2yI@j9(H{cRt'
        'rzdBUVpeL8vw7p{{7_S`Ky;#Z!Vr+6|XO@zK1r{^eoE(5w{H<fU^ih@9Y%spA2!w@{_mEzrXzP0=md;i&JiK>a{q1|0F+o{pQtwU'
        'p~Kj@#<x9xLq|n1!Vl05sI6?`r*a%zhfK0|I?<LR`q7vo=$fS&hE5)4`-'
        '{qsTXhxsnK6vzWSdZF2DWrCAKrQ3cZ@;)=sh9Ad17JUj6ju`DO8!%fG*cR-bY>$$)#?b#tE&vK&vwe6jw3zwfGYR<w5|{%&@-'
        'HS(+6A|h__Pm2)v^(6EE=f1AWW#v_eexH8z2QDJ?DVF7`o>#5+$&n~P(6&;arfVPpw(bM$`nQ*WP(NJata=1UKD@2Bce|UjcG}=N'
        'o&k|UJUO-K>~G_6`EzULV4KQ%D5OcE!0>*#khVAF^j)=@ot2x-'
        '8E!=lWcAD)p%l&yH}}cb25_!>Uxb}>HH!xg&+Va>oh0HB4L!trbUPs%$IP*w7OwrV4R4$EhwUA}N3{!6eyCNoX^RF%T-'
        '_eq0@zUlY+`X=VB5AbY~=X8YpOXAy1N26?rH@CtCo+ZX`j)qo!(W;^4R7LEPwT(nib3XwqXw1J$STtLc@*+S9V)9>7SgOOcx-xWG'
        '`04N}lT}_5NBecGYFmtegIby5B%mXfmtjz;%J(G*u4<oYgE<EI}qJZ!1%`o@Xe5*zY4t@|v=4tMrJ{g&72-'
        'nDq+2Eqd<}6w`B4!7*8ptT3GImYbHp4nPb7I`^)+Z^u^+{#~tFlvT=hTG!+6%0&xh<pO9F5ZRR!v`Fbnpz7_omk*F&j`Dtg2rIRo'
        '0lzem%<5YpxG6CBtn>Hc=6+kXy%6laU9)o5+mIx)EI-!E-'
        'Eu5M=EsY_6+d3QeDU4o+pFT6zh7Ox^+%C<Mcjw<PRt4Fq<}>E$CPI^NvI@1o@al`s5JZ2IQ#ni{6C+3{q@tYp8e;u^RK^tBHflvi'
        '^%%V9WH?R*Y?gx0Gww97z)TG6$Y?k(`}zdX)D(*8zU#>gHnKOjnXczIpZjBC(RUDe5QuiVVeo|#Nq=qH^_t%a0`;YFX5Xm@;-'
        'HLWaY8yna7@VO^LsUGvZR3kP;MPSj>2M_O>967${^I{(7xt3z}K}Zr4_;)z6zJr)7=Yt*Ta4lSj)V?X5Jzt@koz%hN$@TElwY6HA'
        'V|j#l8>$vG1^H`}Ifc4!Ei&|-'
        '<_px5Nr<>~zV^y|r|XXg+3Ad8#!qmkfD_AK_A25^ig{cH|83H$<t&3ea4R{g%(f<Uo5um`>fMhiL5_pRIMC)4zIGP~bR9$cY<63P'
        'RaFTXIOWjI<kTZ4Xr^zx=&MR3bh8EkJ&{zXz^-%)EzdEk?`Ihww3xuF=aG$evC+bK7-'
        'Jwd{PK(StbFk^sj`B$UGWNrB#PRyU{?f1JIqL%G2d;TI@?pjpywoMJ{cm@jUGTV_ZT!Xfa)lN~n&bDii4M0K1UN17xg-'
        'c&Qw`+`AF=7I1?Z9O~VQo&^-Da}@eIvVg{UQS<x?-7fNc~;iRWQ<`f<?=2K}?x3P_S9m1_To54FKSYBY+7Lf!oIu!F#9(-'
        'SKAoWTFO0Zz|Ynm@Z6k>n2Nz4(XDt+HdcNvW#8y%dNUk!KB;}Wk6R%gr7kx(ub<eALv9)*UQbKf(66nk*0EzcEJ9z;lLSBP`Qw5g'
        'fP)zPLI~_cd`~7#Z5td;h`6G8-G&99Qqy+pGCEz_I>1mPtMP6p=~K&0L-'
        '6OH^!KhS_K0#z&X5y_05qS;o4dv&jf73WK(KsVir}G50jWNN_$ILy~d8-'
        '`n6GX@M}8OabS!aI1^KB3>)|<UzRoPV7)|RQFR97W`<(a{b{8C3B63QcNqar_R7pZ-|X7E-'
        '2aTkch{Qlf{L@eyFX`46M)T;M3~X?hARFZcsynQ(?g$2k<l@G@OMga?*ohY+x2TX<^h<ADL!_hg1W~5k97m)_Bvo)mi3~M(QOSHH'
        'A!wTCy0JmNII_JND{%oe_{LZgrZ6T|MH-'
        '2vGSNP2eKTVX45sbcmgQ!qcNw#5asfwzTK^Nt>d^bi~$M99}8gD=YGd_3oKZ)*tEd5$ej8lC5X1gYjv0^_-'
        'zhRg6`2ej+bA_J5r1r*Sc`hg#@&RM<D>f(ZIli%)$VR&l(mPw|g35tO-'
        'j&B44tO?SyN2Tc;b)L~vbIrxT+3rT~9Bh~N(pUzC_>(Wd%XO?RYouqi%9>l!wW@S1+qE5$DXyRk4t?+)qo*J8MIXFw!yB0NW76uT'
        'HJ$b?-'
        'K%)x;Q`25;d3~^pd>5RCpZuM~kjj;h}r=*z2>WHn(y0#pC5?Duh_GLVf5oY(0PS<H$|56q8iZysS!}$3+_%tDD;OYO%z5tov=`-'
        '_BG=y2YBLo4j=A(~r+}g5fIikAsKnIS%7m5S;jOaQ~Qmz<~U(uO5clw~Z?V6%gEC<^=o>5=D5Y1X@g_!noy{hnhz;Vw06peJP>rY'
        '6rd>tMiOV`dUr$bK{(1nn+8BIw<<pCj=(U_`_WV9=OsW-'
        ';91M>%nL1X&3sirV1Yk=F{!D)0lSvjw$g?|XKWQa7q*B_z+hz`IM*20Y5vflBJ7q4NgX;sZY@jwwbPmxQ{%0+`Tgj@7?pLSRP_Pg'
        'eW;gWo)VK&C|HvC7u`40Z&*`R_0A2!v@DWdgizHZT8SHTKy*IQWPv8gn~Zz$gP`U6sJ;Gc76Z&XB*Iw6Gl{rNeG^a@IZ0}yGq+9u'
        'aRlyB?<NjLR1^6(95^B`NUXJ}x;??dd9OX*M8>8e?k3uNI<_Fw;%J^6#z!3M-'
        'q^xkPlXAj%^5}Zs4wOMR3tN}@H+Vx_$t$Iwm^8fwcoU~nlluQg*NIy&=E@bG2@=Y>;<Wl)lj&k#m{xi%UXdURg>3!I=pq_7f`B@G'
        'q2YU3De)c;Dz<v=!hi{7)Z-'
        '03CmmV%!clDmG|J{#QTpiD@?c~knpA)6uzIel>eNx}>z=*DmTfVH8H&v7S1LMjJ%h@ck@Qim~s?DX-'
        'mE0V^3gO&S|NOBPfVzaQUp;xc|9EanQa!1+E(A3P!cY|4MkXa<B`(Oaf$rsAQ-TolMPQ4$*v;x~W)vi`H?#oc`i~jXw|WISl!O;l'
        '4cbG>RrdYW)oT|t&~De8p%^6E`{m7gF+feAsc!&3(ezq=FkF{Dg8JZ!Y`r7}vZnQdoA&r0MtL_xEq3{ftE)FJzWM3u5-'
        'qbA&iv)%(VB%gGg_D2X~Bd4zzHt)iI$<H$oiIauvr6#KyhMQlZYn*k6+6e&s5Y#ffh2ywnA&7ni@fT_6|l~RI^(Q3n}YmFi%pqTf'
        'G$)FADya_q**$_+8sukg{^A*h<cocx-#-Q4tdO2id<fXv!A@*eD|2;rQATL<K%Vk@Q5r!x{>|u#){Va>-'
        '};RS3A?413uSfK~?wsbfe240@nKMAEQ!t1zlo3e!C6HTHt5j$>&-Xb?|;IzIw>&r)}{-EIn_AVQxr=o=Y)q09R|8{|@$xtj-cmu6'
        'w6u9C*cS;fVkw+fAOtdn5_B$!`+okTODMgp0WALbej9J+7H`^B2&YchS~kVxDR9DiD#DV+Mc?(WAokbmOp)(#rr`)91UKObCP4fu'
        'nQd#HW`9LNCIGyf9ZM}=VBjES1qSTgfxg>FHVu<38>?rV38Eo`fVZAo{ArkEHcs1U^^^|<YI-szT>1;dq~7`Fj(pLH{%RWjXRdkl'
        'ZeCqopULFgRm{pALR&Z1Qk$Eu2VHL}R;-^RF>4ea17_cs<#M7`Qox-T1C*NF}r^x&@v&!zI-`6=KLLNiHGpu=+^y?4!KtY!m9@-'
        '6?gHtB47SFUa=GESJ5fs}*%2e4zg0r>sFkc8}n;v|97w958FwBI653MN=e4#&HzG7cnE{a3&QN6FC`QT0ZoI$xC2cdf{FBDn0CGx'
        'w_KDdNtxH~9%vvrVF!elQ+Y_KSL4v#$=%UIa-V9QomEk<^)-@%0VH$Mx_e;<^I?8f1tiftMc2@how*AvfYcQd1-'
        'zL!26Y1e}FNfVhNn<PpVRKC7H-'
        'OA}~#NWRf4ye&aioMoS|#e=T|`ylWb=M$OEqPi`o_k|1l>scAnajRBDS14_Z_1sCYZ(P7FA)3V5Ad;WXK_bQ=qKu=9*3E#l(DiPc'
        '-7eNQsJ8DooYe}joe`m4)D~*2=BH{E$3RIxm#^Qxp$~7lTs2CETS-HMpZ0V4p=_#x+o(=DgT17mn_az_6<u*f>_w&ckEWVeP&Vt$'
        '8`5JNTys2MD1@OG8H1|(T4G}q1;Lj|GI2V0cG+5F+Ib(40?;ovI;l6k`O53xa3LMX3sr_ifgw9Z0W|fCFX(UH(iV$y-'
        'tfYYG24`NQvjs-'
        '$j$R%kkmpI!eiH{8e+fn2S8c^Osy@z*bfSm?gwDQw|5_0b(jU!*JaT{nzK%fih{LX8E*5|;BYTQCbe2(T5|KgU*8*aLD7`fH*7!L'
        '*Q$SF&<s`pdEX~1LXS9@2xwfx5fsSFoq%mZjnL?=&ap7^hZEt%FnCA5=Idwm42n*=Q~2;%9R_Q-?_Boz>=^dy7PUsNI-KzBa*I0f'
        'vTWW}+j0KW+Z@eB)5Q+ZS;!1eog&+exV6Dmig2M1I`U$=TM!d*<Oi5a=|K^UeH4HPVKODS&|iGPb02Qjn_gbTbkpo5NkBl%zW`v5'
        's{3Fpp(J_gkxVCe)>#W2S>r>_OA95qxCYfsxGn5@IlZ&=(TT`X!Nr#*>M&&XM~enX8gwjUt6k+q0>-wUBi`(#z-'
        '|m+a%0En$PO^3pNYQjfd7JKJ&+&8tS)a?>lTJ+ttKkp5*(InLjHhbWBV=dd(3Hl#U>X41!<^&oJZ3k3cE&_)i(nOd=t2RtA+q-'
        '&_K<_HPNL(^JFugP5g<?VFt!T-~9(0#Tmx!_C)-'
        'r_CFi@cO<OH8n?S8?Av`oa+<83`O8VqW`{|{HwK`poGD&whaY4Gg)@SBcf<{jePPEzT%3awB|lsL+FrciK=(pbB+ZvyIBb2XSGpk'
        '=wxO$dp8vG6Vj8bK+W0bupxLaR1AE59H_AS7HzHJ0NH1CJQX^gSFW+CPSDmat+=ZH%u0fLm#C;<m+HstgXqDf)vb_`KON@&27x{l'
        'bC1?{Vf>2--'
        '!kh!Ypg=lz>LMDk%Q?_yK2D5k*X{@^&9eUxiZNER#!U(D7HO4Nb%ILsp@ICRwUbq=+QMd*O<_LKTK=>`^C7Gy^>N1hc2+I6q@yUA'
        '-C}@UbhD~!AfBvH<2}6(=J(^3@j-'
        'fmN492ANbRd;4u(%a@|t^7&4?FNL^6fNHfd*9=0PEh?vD4(+d=emxi#o#|3@WmCCEbLDg>MA>P0B?@7cGO=oodQR6z|H$TjGUSk%'
        ')RqaK0qkS2{p3xp@&9@!c%5t_baj$+M0=Zv|oXf!8K0ptj8*Jkd+1WwuY_|rIA@&7|cMAFWOqMhRLdC*8^MhuK29;SupC1W3nO=d'
        'DJYssI3QLcx8jU~vA7<a-Opn=)rSgdpE0%O-'
        'W^U*gjePn6$@oib*`f2<VV=rA|O=762agy={YAfFoqk^Yw4l^*DqDfR2bk4f<s&dKXq{{=UT9biwJT{7fG1n?R!SrbM)kd0IJ7qu'
        'NU)Zy;5)QnA!-'
        'qF(a7sX^;9Rch2+>hAyUg|y*p#C!Cn(^Bq6UkUx<`$>*n40~jw>lEvXh9MB{?O^_{ZGdn~D3T#dj5?e`JW?Cj|y{VYU{aQ?d7$``'
        'Cd!iiR6tRIBU+TJ%O*pzyvR2iq?MjXW_gX;Das0-'
        'fT=C=e7wmO2t4qhl!Bv1n98$_u%Sj&tQZQ({v#dLvNO3L|~V5>TR*+}0I&xI~Y!+?FhGE6Ur-'
        '7$ZZ!vb74{;&m35KFvABeS_`Vz%&rScPoso{|Hqvx+F8ELTi*0>*bidkUcZp5Ty4l%D-'
        'a2?BnrkW;LkAKB{qi18AppOLwGA&;$q0?B?_OBj2MTvDidAfU*w<-E<vC)P6EiHzvR@sQ*A7$x5uWDO)Sz@+-'
        'Rla^GLBk8?GOQITNDRk>;J*4?WhW9(ap)jh8RMTP)~rVB>9?91d5*ntt^=d9ml^%5<oKp-+1*4C4`D6SNB6?=S--'
        'X7%xl*NicQ0o@C^6bXB@8S?Kiv4OU8kP&TIuIUZ+7aDym_f7foGrn<Hg-xI=*<1L6z4GKD4r<lA7|WY7;hE1b_MnDN|luy(mojFf'
        'A`==zG!^$dxMEWv`0@UbpRU>FjgXPma)oc+@hPCnoCu@|FdR|VK5od`wz{U?)fB$kMACK+Y}yz(OwswsxI?W2gB~ntZvKOrUKoF0'
        '^g)+-uDRU4Ts=bZ%!DXW851`OU56bssto;i>{9vQ<rRasGTwsc0#<lCM7VE<Ju;wKsZ`-E;sk?#u4lz<M$t-YY@-'
        'c3a|Fkm0;jK74#__l^2=QWB`-'
        'L<RubMWDpJ`Aa@uBXQLG;s)!GVodxRvio2uJfY<@+Am}%6!`)}^pUA;!|7fP~h!P$Pj&ufan|0fslG!%9skR@g3eap(uF&KMQ(^N'
        '3b8krj!!av@Q7e?%{Cih7HpV-'
        '^1d%=Ib9YdUsi4DJFskN8g1SNHd1fLO#ofj$97WUcQnz%~S#Ap8U%0Et*U6pGq6^0uRAvJw=a7+Nf|9%qq%{9rPn3a?BCvKVlV)R'
        'qE`O@VhAG&S!uC$;EBXLOT!kqR-'
        'f|=o#KIG<K2jl1l%jiK41Zzp#nrKrp;20~N3D1pkEN#pb+g_fksIeLF#E%u{t0i#=|CBCg9v@Zekq}ky?E(><u!-'
        'DzX;Zbl~fGXT7`_B-TWRnpU_%mDdaKJGUSqCMZ9%E?x}(IjYVCeie(ZLj;0h5O^GY^K*o_pX3eM(?v$)G^=TwhS8nGi6eu-'
        'Q2T&Xjf?RH#^-LA92%_k2i(D+2F17kGg?&f7-UoOH3uSzFJ<<q;pRt&JVQ*e&4Gifs>c2W~lM;>|yS-'
        'ivjK9wmx_cOR9|8tPzOoK4eH`dTXFLonHBJOyDmaLTqlmBTP-hu#NI~|k(Q!XLJOBM4d-n8e^dseO-OXFU92CU>DPh@zv|4#Avp5'
        'eH%);vP`r@>Bdh*FNRZ&P3TN3y}4O&dDIpoU={-'
        'X9#;N|4_P&L$v8JvBQXp_!Gb@zs5d~e7&=UsG<`3f6<?S~@r1u0$CLgF8wZg;vwH>;=_6!*}<)zWom7fEX;7i?J^G^CF{?VvmM!E'
        'Tw7R7CHj-??Piw+V{Z1kF3^{6Qc2F!z9Gmsj0zgdo7qqz@00ApO6DK445-'
        'z_kv9#!>CrVe;UNI#|D3*I^8LegUeEqyr1CaO)m470pHQPzs=BKP<^989UPa%!MVddsC+4Y^|wJZtQXWYaf)vS}W!jONAcm!lBho'
        'G;_Gqk$09G1_3pM@|dvVlkl<MG3Nhn@^I$LEc#<cioFV(1;|)r@%EPKg-RyAH^PQqv(RSF7|BFr);5_tG-<H*uEH&QhhAsy-'
        'J8p!CVClUUS|O3{WcIPUTOqKwwkf%A(sQHHr}*^WNwbPpF4pHP2vO;UUeo7I!^BIz%U3U!i3ORw!s2>Z<I?=D*Ulr0QgI*NZBQdK'
        '_$A8M^0EjTv8=);110djvJc~v(nc{L_Zrx(S_cEM)J9`punmmnj2{KnoX>nOlm;iCpF!Dcndv=#cvgj&ui1&Rk(PODiY8G41&x|J'
        'Y}z!&{EVY0eK44oYWeqT2B4xfUX}<nLw$yM(`$dfeD8{*%!QvFkI)(Jixb7V&2a6qC3*jX$_hg$h$`1Yt(OilK~EO78)$nu@5d<k'
        'X@e`5;im>)D-5Zw)XcOZmFqnvtU*%6pZ8>f%=qHZ+j{OJBLkHr$OTo1iAJdTu{-Mz-'
        '6RK^3Eb<o8rFsjwKbE0!y#E?nm)REe&JZc(RIJz=VWiBS91dbOi(ccB{=;OYTKnL|*hnJxY%QWTx1)1*aR*StKN2gImXFAs60EO9'
        '!MRGBOx&of>CiJ%CjaUJvgu3QM=@Gdjp@5EaHlDU37mL?xU=s+YQ|L-gq}l2Fnysd}+Yff-'
        'S9dLz3)gDe5&h^IBI+cjb~UKxH!4r`8bH~7g^Sv03p)0Q%^9_%~4NxVR2r(<~H<tICOIJLv0Yobhjq=@z5Zp7~9b)}d>+`?yGDG+'
        '>qmxRHL@W@RPU_1B6>-MM>iks;)DDK=y=@A>_2~FO>-j_+-'
        'G!U<J+u+k=pRa`&6K%qonc0~L7Lq6<;cy9}>5jMrn!@a3FM|3I3wU$`wADTXdplH<KZ6F@*xxxR&-ZdtXKD8Dg-'
        'W@Yu#X@vHr`fLbKor|aKr1-'
        '7i%p?j%CrC`@#laR@I8a{@K(xP<CsP?p!7ZyClK&#>ACoQ!~8Q>=lPso2{q};E>KA_S<n|(neN_gb`hSUR58rCWnPBZ;d%T6gnjF'
        'j5C$E%d>lYddZ2IUAndf6XUn78=ZE5H=wic7^^%)B!Zz5P@3Xv{e3bdIkiPkThAbb%DeI<WqIv#BAWddiGvgLS@g2&hM8~@nFDxo'
        'B!1(serPb=pWrAp;q)D0uV&XR;r(*|XXHGR#bK%3zf>OG+w<n4OsMRPXM2S<qnt@(@2R_|@nD_&GBn2y$X)CN$u-fT+1PV|X-'
        'j<)W$bB9&xU%m2c2RyjO_tv)RKM(<@ivx<ae&&?^S5Ae9zGYkwM6kSr%54Af_QRU8=k=<*bAjre)89>}#ctPl&cJ@UNE$Ih$L&Na'
        'l#3>O~du1tPsB0AnxjrLshN=&{~y@v4brbwVS4HH$9l@-'
        '^cvsq#t=_Dpe3r<mu0PiG3B@^0I%v8e{8H7fOObIR`ON7iZggRCZBOttjGw^8Z;am>Rw)$_H)7j~NTo#P_BEY&$(pMp3$o$psrA1'
        '0lq{5?sVI@|(bHGLba%P8NS=qY8v?10By-1q68=a%t7iTyKsT^jNJQ@lXy+b-'
        'Mm<1I&dH<H`u&JVf#*r(tb8_DCvWj8yJ{I(?WZlEMc@JcC;g3NZd`wkD6pWLp8@dg8)Qr}t5wWC8!ulw#=0*z>cL>{G=vtuvX(cm'
        '7&9ODOb`SZRrP8{zPbBYSHa}w1O<kIu_edNZ8v+O1J_SfKVhg-'
        '34Cbgri!jddwgY;;IAvIo>X&)$w6p4+B+KI)vt87LY$+Fr_Z<U~DDr-BtDdNst)&mdiO`SqTOLUQhRCjb%46Q+NZzDc(9N}K{4;#'
        'MWtC|}=OkPrL|6pNyTs}#1O?>7;{^8?l?Y!m%c{uD<$33@@?IyY)ssvftgOqTt%wl+c_|%+7Nhqe(V&NqZvf;&ajkKWe9os>pAp5'
        '31RN5EQDH^iaT!XhYZT$8<8!oC-'
        '8sU^GqrHMsmoIk96~;hg<Wk<OKk)B|<oJSnJq82@=EDUO#yC2jL67?H52?;x8kJ1jlnfVOBOTJ(OB$IM+8!Jgq_Bb&5#R)G+{;pX'
        '&QrLnHhJ6UV_}xR#LZaLzsP+cWrwHuW{YsiR6<r_WbT6(-V>-7oh#ax^?K1e81g~s-'
        'aMKRq{)H#+uEHgXTbwC+)CcU^a2=#k(z{%DxQP{|GRnyOKZ3&1r4T;py_6`7fX*@tUzh@C|y&PbhUF|kZyuZUQ0u^2JErK=~cjzg'
        '!Vvsf8<H?_2RYcnMM(TA>P<QSEY2er2gJj_C_D?!KQ<&cU+hfXDD=I;_@8C^ZjWlaz6zhqa$CMZEcXNJ?1VVSJ`P((NI8hZr7x4_'
        '2L7du$Xgq0J)w4Eoklw<|U41J%;BTTx2UsiKPG3&kTmSJ=yCOEpOid8Zc_5j)uoRtjX<n9JE<<%QzB;J1jT&LPYPAR^&%nhXo>WC'
        '&*b1NBgqXCGPx~d5jWMb4l=7bQ*=bL+*6me7sy_ejYQdIxuuG314NZW|olmUDN<eukl(KsrHz`JOxqp<SUNO^TqCebxG^4RCgA=7'
        ')=|A>O}$Bu&e#%hh#JmJ1G<9gtVF0OV{Lwk9q+=u0sj==|7z5QWx~o-'
        'xKts;SwjcvoULP5yxd5vcMe``$S=5CtVtl1L>U?fb`BhCh}Vb9%cD+6GCLPbtBf;fU9%>pO+s-'
        '8N<Y0W1|nzDrO3G#At`P$6FT94X-(|iREXU>r2?Sa`Q(~KPGuncxk|-'
        'C1LWe{6N>D{dV|8_R!6UTg3BW0dJ3J!Cqgi6#*BE9oE_9rMIN(F9{D8UiS(643k){F-'
        '@EeVF}!fCtY@g7*rQoD@E6*PvoAsUpHkFaBOeANeM!(yhHZs8Yv;*bht!b>-'
        'T_dOeo9;b5R&!V=eo@OgA<ho2Xc`qt|?up^VT;Bhn#T)`PN$OXhJ<<ZGll&&YnX*AE;eAA1_L3Ej?7li!PIBSO&me%CKTM~TXEFJ'
        'C%AtuxHiEU=!3(AJ7<)~F34(?n{pY|5gq(2CATRg+aMjF3yPtMFb+hgZTi)czg=hjsOs`=xvdm{O#5B=YS%7hW^1_6Z9h+}W*cT+'
        'q7FcbD>q$Mrn+S-2F3^-abp_GkR`Ha~8VBjZ?LKHqrsTwWnqbt~&3<FY<my4vbs(9YaLS3zCfFhJIQv3x1a$Q}9bX)4-'
        '}9WyEAqnA`|GdvOtLq^P)X&hHU4oHQp59_w_oLAz0OZngfmXFRYEdV^SC(@57pDs?pN2rv^z;fWOl(Z2ov?{eb3wwCBbG!XUYSO$'
        'yGGPe#0TrB<VjO}_awj3iT}@VM=IFlh?5x{8Q7sT=eG%i(+C>ln$pXcNh{#VXtD;!JaE^gH3maqu(xVvdlHjx*!%A2|;T_C>aUh4'
        'yoCWGBtV&@6XCKT~o1<uBH)0s8@Ufo6|G0Cd-'
        'J#e}_^kEe(X99LMpcNK81t}*K=DHTBQVFM+(Ean>`{P<a&1zQ(3UHkS}9`)l62s6@L3a?(AldxRF2~#eZRuU^Z;7j+B<^h6n2N*X'
        'kpqns;uE%%9zbH6TaS{*jpHhesr)*I)vQ~`S{THw5)AbAc}xL5NqQ?z;$#`^3tAzIZ*4mS)$yJ-'
        'k;<l;m_~d>d*H7Tj2NNBTg)x!?kl}4*9H0G%^C<>jXitPp}__N++jYYBFX1t0jZIknKy;q-'
        'DXbdtwUZC3TRN!=*5k#L+(`xeSksw30=Nb%!Jnkrv^u^6$OX64vG$E|OL~%Gc<37Uxy>@{;Yz%oeQgzh@VgXq&`aCS#Jh3#aZ?Az'
        'q)tz_+Nd?O+iXn3f{w&da1{@`2f8RW31DZL)0OeF&JqhoPU>zPV4uiBP7HICEDrJKcfgT}P6(fF6@eJu{axpX*oI_kf!OFEq`d6H'
        '{gTQmw);GnX`sN1*hFiA-Xngm@kdqY`D1(iA0vP12-'
        ';*<s_8@23z>%Zu((*tqi+n?4oe&ZCkZ!0r8E8kEda`*}FyrM9)+6I&9if;O8`oO3vtY<RFYukaw5Hn`s%g{9HUQaj9w6lAQ6kcnS'
        'W9{?$S<K9ZB?jNkzjuQC`=V9E9a^LEO;8!gXOYN=PYPDNps-vnG=6g-'
        'd$O(JD`bCpi%1nu|@sk*`anN%E|B)FPUtw;{piNIc^hGn-'
        '+m&1jaqy%i<#cWvVl(!5nmM|z!nc+EG&|Hdh~0FTlldO03$H3LOHoA*%YgfJ-'
        '&BrUW0;ATDMl2<;}XTN3hBT2@i3qq&3p;F>uC??q|jm4{myJMF5tQEo>o^0WIXxG%DMjf{??QA4Vw=sxU?fBeEHq(#cvK*Drrj!x'
        '{jDcljzd;VqK0XAUNYixxAT`G~_6=wgwk-9%hnq)OpZxWK2RcK7!Nx0^edO7WJ~`M8ZNSG-'
        'K^}%mp0}RrcZTJ}WcH@PIj4VWuqJb9%}a#H(G4LrcQ0Tg+C;315I!akjIoJDYNc%}5Ir-lmHZmLmJ5YSw2<*wcE0uYfY>HJm&U_%'
        '_7bs?4zj^V-'
        '4Yo^!dC8485Z4v6%$x?3;MSF&4y62IKFTTYS&!*OC{&g#laQv<Exs7r^GM{Q^ybr5JN=h;C1LehX1VosmC+hS)l%@z%c$PBkIJwH'
        '9!k&nW-'
        'h>e1J4Bz!~4}Uo}c5H@YK}3^5IPs*H%QkUhI0R95XKv=kVrr&TY=<8F5~VYb9;k88OuNu|2b9akOug%YG+T2ykIm+cJ(%S79t+;N'
        'eI}ygD|&HxmDZSmiNAYwDY((G*hDI1APRYZh;}D@3xvc5Sh+mo51lKEXU{Hc{L#$Zo(h~f-'
        '}8g&==Fp;*ZMmr?0vFl)uR^ZZ_fYrx4-'
        '3*P#(j&2KKp(5I1|?D{)TNecbyMJPNyu&Pia*A0!bW46Ceb9#PxsB+H`i@@4aYmUYp{aZl1X(2K(qZ^BQtjz|t1W#>V%P7_<jA)7'
        '0C!(2(ML}A6-'
        'Me#{_beS8w<YBm1Oqy;UoVus3+j3C_MWE5{lmKn|w1FYkPcz6=61M?G<C?62an>TkiH^wVrqdV6NG_;KNAl1EFgSn;=`mT_OnoDX'
        'B{IA@=P3pE&`zpXBu1SvLh3=Gu0RgoW0iWG_GHf$2nqxmC8B7oguC~$Q}8ULpSex*;Ky03qEn{QhqFnL-'
        't5E64j+5QgVALR^t>6KVyujFCa{Lzqtrnw2|m<q^9U;1M=<#xjW)ot$y<zcP6QXh>>x1A5F%^#@5RT8mmA-MqeL(9Au|=|LqGD(6'
        'O9^sv+Y!xLQQW-'
        ')&cLW4m(Q`&<y3kN7c&EvqFj*13*gH0mbn%B!ge0Mkc1PPg%q5>5y5oBmO7)=iW88O6kGv+8pqzcxgW#AxtNaX7{y$a1Bw}d+w##'
        'GB7h!bVi6XewQS5rBWRl$rlFLv#dXI{Dm>0+H~{=f<Kxh$X1b}+2$P<ZbC|X$Km(Ls-EG0zQX@-E-rdMH-GrGGxFk~g}0J%F+@K<'
        '4muA`&$&3pH3JXo%%x7i)%WoTB0WRru@0KrsA+uJZv%_h0^N=7x#CmhCW_jt=S4h+3uEb|+htiS#S2J&NRqKVrnrfO_R~-'
        '9L>(A4bSR-v21S1p0vIsus0{$>*ps-4szI(PP~Td-^;Nc2-'
        'nmRp;u<(SLK(xtpN>{xvGAIkPOhctB>NKN>Ldd+GpZN$_P&tr+1yS`;zmq1pKANOqA)C)tG~kxSMtP`x3&HwaX~JcQTF=HtN*@ye'
        ')ZzjOOxveFWrfqnS;4mNV4zm_Ar}l#|v*!J|pPOrZ_41nU_)amzS^p=ZDL0|9pv|gkA=g5%axt?@{iRktEgoC*X%$v2wQs83Mi19'
        'o-pWa-?FaC7G~`bs9M-'
        '_hDd=0GMH%<)tc{MNJ7ivt_;F`>w{KqYUq4O)_G+eP1<^GX~#_<i0>&drV*Q3<zTnKAG2$@9MsX&rl4ATvI}P;rC8IqUTykZZ9{r'
        'l?RMl!kh-HR>NUy@%1|Dt!Mr<s@!gcxeaax*6M|~;4#|I(iIq>$3Hb7Ha~G9w9Nr$6OA<0aK2kC$O+nO^6T<+et!D(<kPeBhuqBu'
        'jhUB}GQ>C?ITCMHWpBT~kdf@uaQ9QRS<yfIaD+TGA&+>_C;dDhQX77FH{Afgh%1*j@5hV372jOEy)3@@JBHmErIU44{<mXj`j&bc'
        'F!A1n1BflYwAk1F?O2n)E6!i#vJMAtXgJ`!Ud;!UuJIe_`;3dtI|ZS?+DbdLpvPp$Ldya^f^bSr@U|&SVy=VD9g==-'
        'XJZxeXlkm(40s*jYnby%_le}Dy{l%b&b}TA@6Z?N<{-;-'
        'S8*2T#A>S!<msMd?lHTM9hLU>+?~qp@#vwqEgdCGh|e>!52fb)D7S&1Kvwpc`wvhBpEB3@qGGpcZ|c?7!FH`abL9H@AbUE<@B-'
        'gMG@V|e4b0)3X3_%;A$57W*tNA>!sPJGwv{WF94GE-'
        'v8|as0TL%kqh$UqH8vzDbzi^!VGqCgJ0BcI0Zom@?xzr!vCtYXCH&rJqq+{PxH$^<T#aM}+xJ+(K4h|83VXIaehTjJ9C%DZS+4AB'
        '5_GMIw!kv=@EI6cXMfI7?{ZUVvNzS^!DH2t0}|_8>ti!P=aRgpBf1j5zhY9|d0uLpCq$nj^%BV=d`F0v$%k+}?CCn8HbT|zrgu=E'
        'P(Bboc~RAg<azbQHZN>N25!AbO_wLjE(AgUM*#YCz2Oo0(VE?=-'
        'EB5x{LHN}z7ry+5wLtVF#mROei&175^A>XIxvY+6TDV;94GoytsU;mBW#rF&(8+$>QAous*~<NnFEk3BrnOtwDMpNF(Rmr;)Mom|'
        'AAV&9hCcIDoQux9`W*aWWDCEN2a~z&9M<{__e3H*VJ}@a%T{U!#puT(5343GqO9&tPZD-'
        'j&0ZLC1(jZZX}^}&=4@*HgmgXa+<SlGFy{j11S{-'
        '+?fP^c4Onf%>c{0(+FRu3GajxX0gv8T_c_L62l@6k7=>g#!^K7iPZC=^0*i3ESVLJ71a*b<wgn11}b$Gv<s!fOt+I%R(Kukq5H3A'
        ';zNlq!-v7i0Z0$JA7M4<LX-#yvdo*`CixUq(U}Om@!S{y7K5pcs-lWhzy*$UgeNfaM22j((>s_h?w^E48^ey-'
        'M#FwXBLvV(BAy4aOMnZL7%72akOjJyasD|FEGu%MZti0s)bQ<CuOTN_|LPCf7ul2Zr_ankEZ~Y`N)mC>%ID!4bhET*EbHxW0PzR*'
        'm(NX~zj}G~=HmHP@%rNG`#=&k4Z5{Q^@53CS;4YdgVb=(^<TgG;l=a64?-zJ+J-tT>3S08#V?MIQZsj%%*%Pzd-'
        'Lkm703tlbmb7|XlnKQ-dmi{UwwO7eD~sq%eTD8E@jW7&Xi3XvG*RhyO!h9<bMioFL`c3$>M2cYkc#2PlKc6b6!-'
        't^eB8fOIvKTw3bSfGsEV45^C=(KK!O8=g`V>_r!*y(~mQE=Bn!vUTrnjCQQy@EmgV2=mgC6n@S9ye6`daiSC>;349(oWabh#5D(E'
        ')*xRS&G4a!;FLDcsdY~U)ZdEcgv*cFSQC}=6r1c?-'
        '+TN);n;YdM=^&0H|0U3l73n0P$LVA~jU9E`xjF`SM$XWRiuUlhlop>1sL>vYVO1}=+iP0dqip#|R4}WIYTTZE@~O7FabltHD|Dk@'
        'WH*l{qM2lDWhdFuESo)Yocs*&hktYr&$0lWJr)XNr|56Q8DMn@AuUT-Fh&Q>7yFhWFkXy)JIh7qpb_adqsAotKRSff{?TTLZYVy-'
        'y>rl|(>dB9PmeSI7M>T*n)^+~n35It$|)T#k;c(TTqq0RD2r@@oDhR+gR1A(Cf(1gy+6{x?}}1XQ5PmHmHp~;@KHi7KQxHsoKnYj'
        'it!=HB6rIjh~G$pt?BVtkXdsf+T>q>87Z>|&O)i*qYkC~sDO;rd1&LFW8LWSy?4BZV5o+#6ZJnI`odhHFDz+88%NKC={?87s_A*j'
        'S#0{25DFW)_c`!*8R3MS!nXG2k!abSZI0wr1)2z|p94^k>g@nbVPd#$P#%szZ@K@@Br5Mtyti7jd|lXh=c9WUfRO%jpDsCE>k`AY'
        'hdTUiH}2RS`^~oJ=mCF&0~0AT#~+z|zH9Ijfy<tNDVYkBX&@bWkVp+E`FbUdP$7~8^l;Ve4tC(jiqvh9WPd5H=iHkftPeU~L}_G$'
        '$kgD+8}z=gAqEA?oIxxB7a30bOT8JG3lkWopsu$9?NSc>kyZN1<X%`iyBeo|baa9XH?UB7_J#;vZnmN;0Dj_c2QAkr2KfJ98}#5C'
        '3*1`uDWI%}{}gTgOT{lth#?kBP{5+Okc{w;7q5{i-EQwfAJ?Dj?f1JI2dLa&F;)$?CCVwu(6~=N%xK?r--'
        'aN9wA+^QBKd|Cb3KMUqc;^MXE9?ETzCrcPW<qy!uu~kk-oLjE1Ra8*B{4@|DJj{e~KxeTIzuss*4WjjTvXJVJCa`vrbdS3N|coPv'
        'a#=%Q#<aU_Vx&$@>lmCDuMV5XYJ)1@*_)mhfmksZHCl#yL(X;Qn#whqy3YzJvev;ACO?`Y}=^uA-'
        '0vy<WUzr!eTL^k{rvLwtdyN{^Q6$*fSSwZ7%cXImNMM3eg0o8)XR7iCb9(b>V}kmFjLj4;^PGs@tB{c8}PB-xs0y9T{o9=_+v6>}'
        'q;Vh^VR%l;+w!H(>?H2HDnjpWTs*&}dXXla<FIvFzV7(_~r<3ZSAFLpyGY~AXs86W|@VwVOtZB>7X!lC+p6s7)d3@mgT8nI~Ljk4'
        'eJ6%B(oXH@CK$^QpJPFWZ'
    ),
    'backend/app/scripts/certify_statement_source.py': (
        'c-nnbO>fjN5WVMDjC@K&5&;q%R?4A56;w#DQY#Li%5t6A)+K8j+gWWu{CCE7vRR;NE}4(Knddj2Fvi}Y3u-'
        'rk(Fl07gOVx?6Ii7+_AnSJ2Jk@y+@lWg^=b=3_u$2WvhP*+Fy6t%_6qQzdejnI##pg)W)Gb2#xOeM9Ms+#7YL{gRZ>R#VhOo>E1b'
        'v0fAmIYxE0}HP<IP<OKwgGYg>=*pd|YC#Eg40I*DAS<0zThEZ`iRilXRo2YaD(NsSNPCpvVsDS)2D!a;Xp)LyvzF;?EDOxdHCPT5'
        '$t<GeSL^C}^C#(@@l1f`*54u6d31FL}vtC~fY=x2t_Pi3QL#$d<L^vbcB!b+nReb2?*zhq6r;6>_DL#(eH_T7ye$qkdmE^1R1&%p'
        '5@hLMEo8xfiPRpVKpG(9%{K|BqjFFh$XW78|5eG)f+65O;N&Y>TNK!|xB<t!GDv+g3Yog+0(S@A`@v;29uhI!_sXwI&FeQNsOlZE'
        'Fbd<Lz44JV<v2swKmsUhmYNspXcynIwVO0)sW&)1jE87lULkT}~Pahk0gnpiR`5I%y=hVK-'
        '~9#^34$G!FCFP0@^8zAcuCGm)N$DyE)DC&bNsYLa=s?JoVt<&(Tc)H|woHp|$zL9;K?k^e3^-'
        'cY#$GS*a|9@k2?$>YLuJ<}x)|p6>R%DHHJfa*^>_l^>_>vY<?dV4luQvTAx(*oUaXmR_Sr#XhN4TCmZTaO<g)%KKmH7j9J(tq'
    ),
    '.github/scripts/prepare-statement-certification.mjs': (
        'c-pO4>u=jO5dWUPf(4378f-cVx}tNI7TM;u*(1sF*f1ELLrav!L=sh!a^kxF-*+VSpcH2xh5>;k@s7uP{_dF32z{U`Ob~q}p+X;-'
        '`cy6uU9pJfAw@h-*BG5~Bo$FKqq#zb;F>B1D56Em*JhCm^dOj`67R9B;6kAdNTlHhmeQ+r9-'
        '=LZ1<#O|^N5bagr(6O1cg*e@2K4prd%5S0m|+pChRLOXl~yGB~dMMU{BnALfjE6sO0I2c3BFd5|>GTUvn+)=JMArYbjEfbIDXvE='
        '~&8aN$u=E>ac}#dtnkf~#<L*HJ+x<nY@!&ulQxt#<5%JeLZ=uM#>U$LQy)^D|r!A*t`$@8|RZfvUcT@d*Cv9dZ=2oa7-'
        'R>0I(sgmfNKp;%m<HeVg!JIQlzfUI^nql#d#F$jXA>iB|7rWm;F7_CTJ!t)(EE3*X^n8_;=)6-'
        'nhB^AD*2I$qRitioTuVo}eChmT<E+~)d@8e_SNhMgm^z`o0-%~P-'
        '_lMujHg8^UUyd;3lB%TF0wu}lFLW(IsHF_hJ$wdQxRnZmo}R)NcQjPylouyLkTsZKo{sY8h6ihL)hd?Y8b82yoaMgv)eDTUDaM9r'
        '_Jj<PqmL%oahZqO(a6N?l723=DT+R-0B!aVvc?Fz-i@zeIszURBmYHhuV3*FnykRp%G}!j^=mB-%P^rCnXjmjT7?&&bF-'
        ';OgI!OKz&2x?ld2Rl2L(taf<K^%5M21)X%4Ppk*(SYSx(eRwpuUGSXG4)Z0;UcTP(pYlX+aMjq2WgDQTYH6$eAYMluwX=2UoEb%`'
        'IixQ|m%r)#9uw;^gPo#cAG-z1mB36#?uDighbk325`Es)`#dZNtdEP@g-Z$tt16-'
        's{+Z5*7VsWVK$munw<qf@Z18DCCeWfnB@ByM));BTYvZBwMf23m)LhFnV=zTC9RZOxaX#`e}xw2^E9#;OSTx}x)p<Sf=n;*i46CD'
        'U303@nJG4k_dbByYXYGfkIrW7acSU>nHJB+$)7F}1c?AgC%ulNm>Q+ozQi@-'
        '&5doK$V7EdT<bd)xxBTTmN&^jL0zqf>gOz%16VcwGw%oRkFb!X^;z-'
        '<k{@8J9P?xE&FrmmC3OMKlQl1RIlfu?dnR{*Eu?|1E!{g}yJSm=|P8j}P|u-'
        '4pAy_|M1I`*)lWL$mkoG1C@?X9!StI@MZ1HtB~q8=z?;$f+Hm%xvT;pnJZvV8s>mv5=R!GC22S6@8EPcN5+rP}!8p4%D}~+-'
        'x+TIHmbgC8j=ioZid&kY`0o6-5gmM=k!HT%017uOQ>W#Wv%&6~2LYF;t3{U%T31H!M4$b?Eg<#nj-H<!C-'
        'DvYucnQVoAKQfRWqnNnI@t(A|w3P)ranqdsW6cd(~f&vDxJWR`oN~1VL9KLkt=p(?yt^8VLCQ;56QdDGsbgA0_G6Dl9HK|!=1a9A'
        'Amck|<M!QTykA7;W9UHqG_|<LO5DljG$a<}5q}6$Dcn`GM)%tXQh9kDr&DbEbg}|{chaS3aZ+qJSx0s+dqA^J&HQsC*fx{`;7dmH'
        'vx@+h?K~GGFsPp#lE&2ws_waS~_*aKlI%<z+OiDmGJ&rRA%N@wwKpY1KjmG8|+iGomKi(CPtwCra^^DyBbVgw8anW~Lq3Q+XAWZC'
        '~DoQoeKx~J65Vu@m2@@~%58DaH*<?It_w}s3kpMqqkVFC1snaeyO-'
        '7H;=yLM=&E)DDolX9npWj?x++4eP*N$AB_RtxstE+<VXcj<Clq!Df1&!jhRWx7WkEhq4Zhn|g{+OIy&(BVNo7f5~N|~7A+QEA{`O'
        'tDUlS^d|;O#=dXpq#kyHmi$`PJ$5`Q=|mM0c8U5WeThA3I$+E5R2qUqKZ~=-'
        'vechbd&w9_ovqQ4J<i*N4r`@c6kV?K+%uWrjWL(<-`0?cL7T90SNp8kR7WuHfRPt7vOvbgp-'
        '8V9XBBnmUBuHmp^$w;G66uiw}70m{oX9iT&C*~BSXj=hIRZ|mr50JPP&a}@r<3N1VaC~9t`eqqvG%Q0dU%&pyvukS4r096>&3I@-'
        'n4?i2SwkbCi_>|p&!R-'
        'hXyM<P}kt$+*JoVTz=K$YYRZy*91wc7iX}XY}I@5IRUbX!=s)%L;H$c~|32h``{*FxR;bSk|e&P>#%8An(8?37E7VyfzV4Gn)r8w'
        'ow{>)Yncl~P$)J9Z7;mq6aG;Z>t+qJg3e7AdU`D##_9?VQ9>0X6RKk58Oph>{q<{-d{pmBi617WHH#-qJ|0JL@olK'
    ),
    '.github/workflows/financial-source-certification.yml': (
        'c-oy-ZBHXN5dNNDG2#x<s(5n=FRCJ?I!ft*%9|ip=~`7QXLmL+cx~gC(DcfG?|3&GHsPA1jgW|A&oeWRXP&X*B@W<cp}5KfmvF0t'
        '%@B^!dQpgsd!bdQqt&1TV1k>*{{Ul4$EWB9@Vl`%6ZqII8VKep2$r=W{^)cJ+EO@23l~8$tvo7E5Egk(Kk&>~d-'
        'b|Q`&qCSRW^^uCsqeDfX!YaEN!D?LNR0Y#G)g>f=h>;&Yd3Do-'
        '31igTUj8oVz+T8<b;|FNASWJ}}8WI$v#hQKAl>l|ls{lkXo?zoVMfwgA_kMyFSo*GHq%0lfYE879I{!#H`=_TCvz#6CTB$2_}7l`'
        'kyL&qgQb=NIYu)$!4JdU5sB$$5HwbvsHgj;;r=<88p5>ZtQ*T;qp9a4~`fX<fRE?4DwKKiglN0C*(dgXM~@53Li<v&>>n%oB-AZo'
        'Ula&<Dem&T$iL+-I|h9a-'
        'Dy_jfkJnYo{8^?r8n?{QWqT9A85ulEe9s){{R&T}cDu0G5`7ljlGVaBD%t7?E84e?ABB+xDK>3#?B1AE~QSP4cL5H)aXe_j_I4u|'
        'iOesXvShO3;r;jmB3cc4OP=EGqx=^rM0Ei<ZKnPx>HqFs;nDAtESwNzQ|^~jVw(|S1kKG{nS;LZ_Cbde<=4)>G(Uh-}&=U>rM-NJ'
        'LpBaC&RSS%&j5U`r)-'
        ')k2Ij767_)P>n~nH9#nE_Jct78&L4v83u)ZLB03CFPy_GHq2F1g$i6ZBZ>2Mc$1I*9}Ve>T9}mkk;*&uKF?aS6DV3OJB07nBgX?r'
        'C_w|$J}SrXv7}Y7`{PIT+R^u6aoJ<Qe?u*ITeOdvBs>J5S|3mmON18(1fz&rKJV&^WiidUHx)$xuOPMQ>df_8)~w;tN(gQtM}7bZ'
        '<b89D9R*OA8ft7`FMGGa+8iuF0Q+)2Zb`hZ><ql&xtv4MI=yxXBZ;|Y7lCqrvD;?w53Y|AQp+dJFGR~Rb9!ANfs0&3+;YUMlD0ur'
        '1XCnSi#{&Fp`(3Aoz7^y3IUkSyh-@E1-'
        '*0f05L@7BZp3t01KGw9Rs1*FZL>x(b3Mm4Rr?8TSP9O&$e>1^90J6WcD?c0SrZ9c*6=wr_v?cGWVAlJBORtUjELPCx#b-'
        'ku(9z3e3}6u6LOG=+;Gp$-YwM|S;LofW}I&GY4K-'
        'Z+0MZ(q6NR`<oYpPt&kQ1PYQQ#~2q?n<gbPOhrXr6US$63@gDzS&#11tAJjMOFxjjula?2Y}XU+d5(~K7?YFIiC{;z5Pz-'
        '4beyWYbEEqFNJ7#@c^s#TN5vVqc-34;AzOF0r+MqR@9mvCsugER@y(S*}`@g$XWuQaUuCw$m-xjAU92hq=bZL!dN!i1J_o^qPO&-'
        '5Hirit2>rDyRWq%sC%U!72Oib+)>75EDidLI=fJfgb*)v45r4(XbMv(@#$1Z{g~1f0IBn2f_4|;oXms7U9y(Q9a2Pa%_lSmNp+;2'
        'M{P(t{{Xa)hi?'
    ),
    'contracts/financial_source_reviewed_migrations_v1.json': (
        'c-rk)OK%%T48HqU7(RQ|A?NK|g7(%!fVMfb2m}s?V=thWSCUg9$bavw<rtFe#FlI$DPmx?tKAur-'
        '*Pw~$^CS6e0(x)&pTSQ)5);SCuhee%Sl_N-MHcDcs7!SG;<nDGnPfyawD^OGo!X^uHfXfm!5X*c{`!eFwuf9hV$ikOx<cYzaX@(R'
        '~M{{5XdnL*#IfnRIubkPJywWArm+aUV9H-OlGfC2|0+*%*e7fGoLOymSJiC9adc9cG0WGV3;sxmn0*xAS<P#A;V7l6wwl5D8{W-'
        'w3CJOZz_35O^L}!Dh9mr8lBkaK@>SCDQlfbaY|kR-XK|x({wbif}iSbeemYp@4w#OZF)o|S2CK;WWyPVlnuq;G8;`<Cug&!pdx6;'
        'CWFS9REUzYtH?3h9L2MR>NGBt{WXNOl{A;`s=f<f(BxctJpbH`9p7TPp1B6xTfatnx;a)_8C@@WUDx3y4p-'
        'CF_Jkxg7NpLYEJvfQ5h@Gm>OccZ4b;}qI#znMZ)x80@o(?`*wI=a_lQp}m(*1?qt&nnP_6%R6IVL`hMmxSI_X8m?R?%&&WF=(*iN'
        'o!)aGG5FXiMex(%uMf=0cT*|b~q(lhDWY2KE(iLo}zWYI2G8*6$qfoZl_c5<^%kUeXsxruCIV@l9XN>Wb_b;<xGySQawbJb`azzS'
        'XUU!%;Q0A~iz5C%r;zjwtt`Z%1?YBZ(15loQlo>3+{ssS4qwFl0MIrvfomJ4`SAYw{2kW~Q1F+icf<k>({e%H#PqshE?&^@-'
        'eSn?{ONeVoI(iT+~Qyi!umZRffL(E|6)nS4lWRllf1&uy{*|qh>*OS?Du^qd2BlwH=r=#U~a_csQ4TfW-'
        '&aRIg{nrBPHLlw*ZwuWwcO61Cn$<wNo#D@?dxEovfU}PR2Y0}2-'
        'G4Z`Z{*9r54Y?wXBtuWgK)>uJ&ryMMZZtx+#9_gNMm4t_I@bF4MMo<vZD=PCvX0G`&g#8XeBTkA2g6ykzy<vpF9TdW3G7%g$Mv4G'
        'q3|6i_@WQR}<^iK9%V!(677cyqkVpTnsNS_gycI129jf`pfC%OVK=CQ9GhEk|!~H&QhpgZYr;q#u%@g%59}#SId)H7o?PNKV~;)#'
        'tv#7^hjoRl$_E<C_4+;`B<wNSArueu@*HsfJ<6xXo(RaC!{MzTjL5-'
        'ErUwhhuMK6R_?~)(e}YtQiS9*va17_p@^15SWCD}RFVN#vSbRGbA9B~3oyHDwA!25d!cWUCkz0dO6=8)ZZzzTtrz+hHZ=(55MDoh'
        '79Lpb&D#O(!6jecR#4aP(VHUdCCk27K6vGW7vuwb2sZmLwp!=mci@9dIHZWP|A+qXl?Yym;3p!2=V<s|u!Z<RDwrREIG+u}L%r`;'
        'VPIt-'
        'G!J#Y@87(CZ0lQs*GepSRmfFt5_Y0oC=yGs;<T!S!aAc^FFHjN97;B|0gk~NEb_$Gw@3QiA1VO!z`CC!$&rplGx{bnLt}!8O;n_s'
        'q<mdYN$9iPH_6#Jz<`fTa*SG+oC1rE^<b`9E%=m*vRM#Q4H#V?h_-'
        '>Vii|1P3M@o}IeWWbk}EZ_*{s0&3=UJlsIm#whH_D1NhC3H@VT(Fnu(le6@aWxCPCyENOI<oBxfE>a`+sdHO(PO&ODgpZ2VqH?&Z'
        'j0A7cMDii4Tm!N7c#*pK?(=cE4sj&i8Z'
    ),
}


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":")).encode()


def read(path):
    return json.loads(Path(path).read_bytes())


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(value if isinstance(value, bytes) else canonical(value))
    return str(path)


def digest(value):
    return sha256(value if isinstance(value, bytes) else canonical(value)).hexdigest()


def clock(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def timestamp(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def require(value, message):
    if not value:
        raise ValueError(message)


def forbidden(*args, **kwargs):
    raise AssertionError("Network forbidden in synthetic source lifecycle fixture")


def blocked_network():
    import curl_cffi
    stack = ExitStack()
    for name in ("connect", "connect_ex"):
        stack.enter_context(patch.object(socket.socket, name, forbidden))
    stack.enter_context(patch.object(curl_cffi.Curl, "perform", forbidden))
    return stack


def pack(root, output):
    """Stable regular-file ZIP, including every retained immutable archive byte."""
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        for path in sorted(Path(root).rglob("*")):
            require(not path.is_symlink(), "Fixture ZIP cannot contain symlinks")
            if path.is_file():
                info = zipfile.ZipInfo(path.relative_to(root).as_posix(), (2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                zipped.writestr(info, path.read_bytes())
    return digest(Path(output).read_bytes())


def checked_code(root):
    trust = read(ROOT / CERTIFIER_ORIGIN["trust_path"])
    for relative, expected in trust["files"].items():
        path = Path(root) / relative
        require(path.is_file() and not path.is_symlink(), f"Missing reviewed certifier file: {relative}")
        content = path.read_bytes()
        require(digest(content) == expected["sha256"], f"Reviewed certifier SHA-256 changed: {relative}")
        blob = sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()
        require(blob == expected["git_blob_sha"], f"Reviewed certifier Git blob changed: {relative}")
    return trust["files"]


def materialize_certifier(output):
    trust = read(ROOT / CERTIFIER_ORIGIN["trust_path"])
    require(not output.exists(), "Certifier fixture directory must be new")
    for relative in trust["files"]:
        content = (zlib.decompress(base64.b85decode(EMBEDDED_CERTIFIER[relative]))
                   if relative in EMBEDDED_CERTIFIER else (ROOT / relative).read_bytes())
        write(output / relative, content)
    return checked_code(output)


def price_bars(as_of, price):
    dates, current = [], date.fromisoformat(as_of)
    while len(dates) < 260:
        if current.weekday() < 5:
            dates.append(current.isoformat())
        current -= timedelta(days=1)
    dates.reverse()
    result = []
    for index, day in enumerate(dates):
        close = round(price * (0.8 + 0.2 * index / 259), 6)
        result.append({"date": day, "open": close, "high": round(close * 1.01, 6),
                       "low": round(close * 0.99, 6), "close": close, "volume": 1000000})
    require(len(result) >= 252 and len({item["date"] for item in result}) == len(result),
            "Fixture requires genuine distinct OHLCV observations")
    return result


def minimal_base(as_of="2026-10-02", prices=None):
    prices = prices or {"AMD": 100, "NVDA": 120}
    return {"market": "US", "as_of_date": as_of,
            "rows": [{"symbol": symbol, "market": "US", "current_price": value,
                      "adv_usd": 35000000} for symbol, value in prices.items()]}


def statement_body(symbol, attribute):
    from tests.unit.test_financial_statement_batch import body
    value = body(symbol, attribute)
    # EPS stays in reported USD/share; revenue stays in reported USD in both
    # annual and quarterly responses. The four 2025 quarters sum to annual 2025
    # for both metrics; no million/thousand scaling is implied.
    annual = attribute == "income_stmt"
    eps = [5., 4., 3., 2., 1.] if annual else [1.8, 1.6, 1.4, 1.3, 1.2, 1.1]
    revenue = ([10e9, 8e9, 6e9, 4e9, 2e9] if annual
               else [3.3e9, 3.0e9, 2.8e9, 2.6e9, 2.4e9, 2.2e9])
    for series in value["timeseries"]["result"]:
        metric = series["meta"]["type"][0]
        values = revenue if metric.endswith("TotalRevenue") else eps
        for point, number in zip(series[metric], values):
            point["reportedValue"]["raw"] = number
    return value


def producer_evidence(source, zip_path, started, completed, job_id):
    repository = {"id": 7, "full_name": source["repository"]}
    branch = "improve/mandatory-financial-source-recovery"
    run = {"id": source["run_id"], "run_attempt": source["run_attempt"], "head_sha": source["head_sha"],
           "path": source["workflow"], "head_branch": branch, "event": "push", "status": "completed",
           "conclusion": "success", "run_started_at": timestamp(started - timedelta(seconds=1)),
           "repository": repository, "head_repository": repository}
    job = {"id": job_id, "name": "statement-recovery", "run_id": source["run_id"],
           "run_attempt": source["run_attempt"], "head_sha": source["head_sha"],
           "status": "completed", "conclusion": "success", "started_at": run["run_started_at"],
           "completed_at": timestamp(completed)}
    artifact = {"id": source["artifact_id"], "name": source["artifact_name"], "expired": False,
                "digest": "sha256:" + source["artifact_sha256"], "size_in_bytes": zip_path.stat().st_size,
                "created_at": timestamp(completed), "expires_at": "2099-01-01T00:00:00Z",
                "workflow_run": {"id": source["run_id"], "head_sha": source["head_sha"],
                                 "head_branch": branch, "repository_id": 7, "head_repository_id": 7}}
    return {"run": run, "jobs": [job], "artifacts": [artifact]}


def build_sources(output, config):
    from app.services import financial_source_capture as capture
    from app.services import financial_statement_batch as batch
    from app.services import statement_artifact_archive as archive
    from tests.unit import test_financial_statement_batch as fixtures
    source_head = config["source_head_sha"]
    require(re.fullmatch(r"[a-f0-9]{40}", source_head), "source_head_sha must name the exact fixture foundation")
    require(not output.exists(), "Source output directory must be new")
    output.mkdir(parents=True)
    certifier_root = output / "certifier-code"
    files = materialize_certifier(certifier_root)
    base_bytes = Path(config["base_path"]).read_bytes() if config.get("base_path") else canonical(minimal_base())
    original_base = json.loads(base_bytes)
    symbols = [row["symbol"] for row in original_base["rows"]]
    require(len(symbols) == 2 and set(symbols) == {"AMD", "NVDA"}, "Expected the explicit AMD/NVDA fixture cohort")
    both = lambda selected: [{"symbol": symbol, "attributes": list(batch.ATTRIBUTES)} for symbol in selected]
    generations = config.get("generations") or [
        {"name": "gen1", "evaluated_at": "2026-10-04T12:00:00Z", "selected": both(symbols)},
        {"name": "gen2", "evaluated_at": "2026-10-05T12:00:00Z", "selected": both(["AMD"])},
        {"name": "gen3", "evaluated_at": "2026-10-06T12:00:00Z", "as_of_date": "2026-10-05",
         "selected": [{"symbol": "AMD", "attributes": ["quarterly_income_stmt"]}]},
    ]
    if config.get("expired_variant"):
        generations = [*generations, {"name": "expired", "previous": "gen1",
            "evaluated_at": "2026-10-12T12:00:00Z", "selected": both(["AMD"])}]
    results, known = [], {}
    collector = fixtures.TestFinancialStatementBatch()
    collector.setUp()
    collector.reply = lambda symbol, attribute: (200, statement_body(symbol, attribute))
    try:
        for index, spec in enumerate(generations):
            name = spec["name"]
            require(re.fullmatch(r"[a-z][a-z0-9-]*", name) and name not in known, "Invalid duplicate generation name")
            directory = output / "generations" / name
            source_root = directory / "source"
            source_root.mkdir(parents=True)
            previous = known[spec["previous"]] if "previous" in spec else results[-1] if results else None
            current_base = Path(spec["base_path"]).read_bytes() if spec.get("base_path") else base_bytes
            if spec.get("as_of_date"):
                updated = json.loads(current_base)
                updated["as_of_date"] = spec["as_of_date"]
                for row in updated["rows"]:
                    row.pop("as_of_date", None)
                current_base = canonical(updated)
            base = json.loads(current_base)
            cohort = {"symbols": symbols, "base_artifact_sha256": digest(current_base)}
            write(source_root / "base.json", current_base)
            write(source_root / "cohort.json", cohort)
            collector.now = started = clock(spec["evaluated_at"])
            if previous:
                shutil.copytree(Path(previous["source_root"]) / "archive", source_root / "archive")
                archive_sha = previous["source"]["archive_manifest_sha256"]
            else:
                archive_sha = archive.create_archive(source_root / "archive", base_bytes=current_base, cohort=cohort, now=started)
            previous_archive_sha = archive_sha
            before = archive.load_archive(source_root / "archive", archive_sha,
                base_bytes=current_base, cohort=cohort, now=started)
            planned, _, _ = archive.plan_archive(before, base_bytes=current_base, cohort=cohort, now=started)
            selected = spec.get("selected", both(symbols))
            plan = {"schema_version": batch.PLAN_SCHEMA, "verified_us_cohort": cohort,
                    "evaluation_time": timestamp(started), "source_data_as_of": base["as_of_date"],
                    "batch_allowlist": [item["symbol"] for item in selected], "selected": selected}
            fixtures.YfData().cache_get.cache_clear()
            acquire = capture.acquire_yahoo_value
            def sequential(*args, **kwargs):
                result = acquire(*args, **kwargs)
                collector.now += timedelta(seconds=1)
                return result
            with patch.object(capture, "acquire_yahoo_value", sequential):
                summary, code = batch.collect(plan, current_base, source_root / "batch")
            require(code == 0, f"Synthetic collector failed for {name}: {code}")
            archive_sha = archive.merge_batch(source_root / "archive", archive_sha,
                batch_dir=source_root / "batch", summary_sha256=digest((source_root / "batch/summary.json").read_bytes()),
                base_bytes=current_base, cohort=cohort, now=collector.now)
            loaded = archive.load_archive(source_root / "archive", archive_sha, base_bytes=current_base, cohort=cohort, now=collector.now)
            cycle = {"schema_version": "financial-recovery-cycle-v1", "phase": "completed", "dry_run": False,
                "published": False, "code_revision": source_head, "archive_manifest_sha256": archive_sha,
                "base_artifact_sha256": digest(current_base), "source_data_as_of": base["as_of_date"],
                "previous_archive_manifest_sha256": previous_archive_sha,
                "provider_state_before": planned.provider_state,
                "exit_code": code, "selected_symbols": summary["selected_symbols"],
                "retained_receipts": len(loaded.manifest["receipts"]),
                "retained_symbols": len({item["symbol"] for item in loaded.manifest["receipts"].values()})}
            write(source_root / "cycle.json", cycle)
            zip_path = directory / "source.zip"
            zip_sha = pack(source_root, zip_path)
            attempt = spec.get("run_attempt", index + 1)
            source = {"repository": CERTIFIER_ORIGIN["repository"], "workflow": ".github/workflows/financial-statement-recovery.yml",
                "head_sha": source_head, "run_id": spec.get("run_id", 7100 + index), "run_attempt": attempt,
                "artifact_id": spec.get("artifact_id", 8100 + index),
                "artifact_name": f"financial-statement-recovery-{source_head}-{attempt}", "artifact_sha256": zip_sha,
                "archive_manifest_sha256": archive_sha, "acquisition_base_sha256": digest(current_base),
                "cohort_sha256": digest((source_root / "cohort.json").read_bytes())}
            evaluated = collector.now + timedelta(seconds=1)
            evidence = producer_evidence(source, zip_path, started, collector.now, spec.get("job_id", 9100 + index))
            request_path = write(directory / "request.json", {"schema_version": "financial-source-certification-v1", "source": source})
            evidence_path = write(directory / "source-api-evidence.json", evidence)
            bars_path = write(directory / "price-bars.json", {row["symbol"]: price_bars(base["as_of_date"], row["current_price"]) for row in base["rows"]})
            item = {"name": name, "source_root": str(source_root), "source_zip": str(zip_path), "source": source,
                    "request_path": request_path, "api_evidence_path": evidence_path, "evaluated_at": timestamp(evaluated),
                    "base_path": str(source_root / "base.json"), "cohort_path": str(source_root / "cohort.json"),
                    "manifest_path": str(source_root / "archive/manifest.json"), "price_bars_path": bars_path,
                    "selected": selected, "previous": previous["name"] if previous else None,
                    "retained_receipts": len(loaded.manifest["receipts"]), "retained_attempts": len(loaded.manifest["attempts"])}
            write(directory / "source.json", item)
            results.append(item)
            known[name] = item
    finally:
        collector.doCleanups()
    result = {"schema_version": "financial-renewal-source-fixture-v1", "synthetic": True,
              "certifier_origin": CERTIFIER_ORIGIN, "certifier_code_root": str(certifier_root),
              "certifier_files": files, "generations": results}
    write(output / "manifest.json", result)
    return result


def source_inputs(source_root, config):
    item = read(source_root.parent / "source.json")
    return {**item, **config}


def certify_source(source_root, output, config):
    from jsonschema import Draft202012Validator, FormatChecker
    from app.services import financial_statement_batch as batch
    details = source_inputs(source_root, config)
    code_root = Path(details["certifier_code_root"]).resolve()
    checked_code(code_root)
    # Relative service imports use this checkout's exact matching reviewed files.
    reviewed = read(ROOT / CERTIFIER_ORIGIN["trust_path"])["files"]
    for relative, expected in reviewed.items():
        if relative.startswith("backend/app/services/") and relative not in EMBEDDED_CERTIFIER:
            require(digest((ROOT / relative).read_bytes()) == expected["sha256"], "Runtime certifier dependency changed")
    module_path = code_root / "backend/app/services/statement_source_certification.py"
    spec = importlib.util.spec_from_file_location("app.services.statement_source_certification", module_path)
    certifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(certifier)
    require(not output.exists(), "Certificate output directory must be new")
    output.mkdir(parents=True)
    with blocked_network(), patch.object(batch, "runtime", side_effect=AssertionError("Provider runtime forbidden while certifying")):
        certificate = certifier.certify(request_path=details["request_path"], api_evidence_path=details["api_evidence_path"],
            source_zip=details["source_zip"], output_dir=output / "certificate", evaluated_at=details["evaluated_at"],
            code_sha=details["certifier_code_sha"])
    body = read(output / "certificate/certificate.json")
    Draft202012Validator(read(code_root / "contracts/financial_source_certification_v1.schema.json"),
                        format_checker=FormatChecker()).validate(body)
    zip_path = output / "certificate.zip"
    zip_sha = pack(output / "certificate", zip_path)
    overrides = details.get("reference", {})
    attempt = overrides.get("run_attempt", 1)
    reference = {"schema_version": "financial-source-certificate-reference-v1", "repository": CERTIFIER_ORIGIN["repository"],
        "workflow": ".github/workflows/financial-source-certification.yml", "head_sha": details["certifier_code_sha"],
        "run_id": overrides.get("run_id", 10100), "run_attempt": attempt, "job_id": overrides.get("job_id", 11100),
        "artifact_id": overrides.get("artifact_id", 12100),
        "artifact_name": f"financial-source-certification-{details['certifier_code_sha']}-{attempt}",
        "artifact_sha256": zip_sha, "certificate_sha256": certificate["certificate_sha256"]}
    verifier_path = ROOT / ".github/scripts/verify-certified-correction-archive.py"
    spec = importlib.util.spec_from_file_location("fixture_certificate_verifier", verifier_path)
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    verifier.verify(zip_path, reference["certificate_sha256"])
    result = {"source": details["source"], "reference": reference, "certificate": body,
              "certificate_zip": str(zip_path), "certificate_root": str(output / "certificate"),
              "projection_path": str(output / "certificate" / body["projection"]["path"])}
    write(output / "result.json", result)
    return result


def project_source(source_root, output, config):
    from app.scripts import export_native_annual_projection as projector
    from app.services import financial_statement_batch as batch
    details = source_inputs(source_root, config)
    target = Path(details.get("target_base_path", details["base_path"]))
    identity = details.get("target_publication_identity", "1/1/" + "a" * 64 + "/" + "b" * 64)
    with blocked_network(), patch.object(batch, "runtime", side_effect=AssertionError("Provider runtime forbidden while projecting")):
        result = projector.export_projection(archive_dir=source_root / "archive",
            archive_sha256=details["source"]["archive_manifest_sha256"], base_path=details["base_path"],
            cohort_path=details["cohort_path"], cohort_sha256=details["source"]["cohort_sha256"],
            target_base_path=target, target_base_sha256=digest(target.read_bytes()), target_publication_identity=identity,
            evaluated_at=details["evaluated_at"], output_dir=output)
    write(output / "result.json", result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=("sources", "certify", "project"))
    parser.add_argument("--source", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args(argv)
    config = read(args.config)
    if args.action != "sources":
        parser.error("--source is required for certify/project") if args.source is None else None
    output = args.output.resolve()
    result = (build_sources(output, config) if args.action == "sources" else
              certify_source(args.source.resolve(), output, config) if args.action == "certify" else
              project_source(args.source.resolve(), output, config))
    print(canonical(result).decode())


if __name__ == "__main__":
    main()
