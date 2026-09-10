# Declarative Underlays: Scaling Purpose-Built Infrastructure (Clusters) for OpenStack with Cluster API

**출처:** KubeCon + CloudNativeCon + OpenInfra Summit + PyTorch Conference China 2026 (Shanghai, Sep 7-9)
**세션 URL:** https://kubecon-cloudnativecon-openinfra-pytorch-2026.sessionize.com/session/1224992
**일시/장소:** 2026-09-08 11:00~11:30 (30분), 7F Grand Ballroom II + III
**발표자:** Hansol Park (Samsung SDS, Senior Engineer) / Kangsub Song (Samsung SDS, Senior Engineer)
**난이도:** Advanced · 트랙: Cloud Infrastructure + Virtualization + Storage
**슬라이드:** 35장 PDF (`_static/images/declarative-underlays-slides/slide-01.png` ~ `slide-35.png`)
**원본 PDF:** `_static/images/declarative-underlays-slides/declarative-underlays-kubecon-china-2026.pdf`

---

## 한 줄 요약

Samsung SDS는 OpenStack을 떠받치는 Kubernetes "언더레이"를 하나의 거대한 클러스터로 운영하다 한계에 부딪혔고, Cluster API로 **용도별 클러스터를 YAML 선언 하나로 만들고 늘리고 업그레이드하는 구조**로 재설계했다. 클러스터를 손으로 빚는 환경이 아니라 **선언적이고 교체 가능한 인프라**로 다룬 사례다.

---

## 0. 초보자를 위한 사전 지식

문서를 읽기 전에 알아두면 좋은 용어들이다.

| 용어 | 쉬운 설명 |
|---|---|
| OpenStack | 서버, 네트워크, 스토리지를 가상화해서 "클라우드"로 파는 오픈소스 플랫폼. AWS 같은 서비스를 직접 만들어 쓰는 소프트웨어다. |
| Kubernetes (K8s) | 컨테이너를 자동으로 배치하고 살려두는 오케스트레이터. |
| 언더레이(Underlay) | 위에서 돌아가는 서비스(여기서는 OpenStack)를 떠받치는 아래쪽 인프라 계층. |
| 선언적(Declarative) | "어떻게 만들지" 절차를 적는 대신 "무엇이 되어야 하는지" 최종 상태를 적는 방식. 컨트롤러가 알아서 그 상태로 맞춘다. |
| Cluster API (CAPI) | CNCF 프로젝트. **Kubernetes 클러스터 자체를 Kubernetes 리소스로 선언**하게 해준다. Pod를 선언하면 컨테이너가 뜨듯, Cluster를 선언하면 클러스터가 뜬다. |
| 컨트롤 플레인 | 클러스터의 두뇌. apiserver, etcd, controller-manager, scheduler로 구성된다. |
| 데이터 플레인 / 워커 노드 | 실제 사용자 워크로드가 도는 서버들. |
| BM / VM | Bare Metal(물리 서버) / Virtual Machine(가상 머신). |
| CNI / CSI / CRI | 각각 네트워크 / 스토리지 / 컨테이너 런타임을 붙이는 Kubernetes 플러그인 규격. |
| GitOps | 원하는 상태를 Git에 커밋하면 자동화가 실제 환경을 그에 맞추는 운영 방식. |
| IaC | Infrastructure as Code. 인프라 형상을 코드로 남기는 것. |

---

## 1. 배경: OpenStack on Kubernetes는 새로운 얘기가 아니다 (슬라이드 4~5)

이번 행사는 KubeCon + CloudNativeCon + OpenInfra Summit + PyTorch Conference가 한 무대에 모인 자리였다. 발표는 그 정신을 그대로 따라간다.

- OpenStack (OpenInfra) — 오픈 클라우드 서비스
- Kubernetes (CNCF) — 선언적이고 자가치유되는 컨트롤 플레인
- Cluster API (CNCF) — 클러스터를 찍어내는 범용 기계

즉 **"Cluster API를 얹은 Kubernetes 위에서 OpenStack을 돌린다"**는 조합이다.

커뮤니티는 이미 10년 가까이 이 방향으로 움직여왔다.

| 시기 | 프로젝트 | 내용 |
|---|---|---|
| 2014~ | Kolla | OpenStack 서비스를 컨테이너로 패키징 |
| 2017~ | OpenStack-Helm | Helm 차트로 Kubernetes 위에 OpenStack 배포 |
| 2018~ | StarlingX · Airship | 텔코/엣지 프로덕션에서 검증 |
| 현재 | Atmosphere 등 | OpenStack on K8s가 사실상 표준으로 자리잡음 |

발표사는 Samsung Cloud Platform(SCP)을 운영한다. 2010년 클라우드 사업 시작, 2021년 SCP 출시, 2026년 AI 가속기 확장 단계이며, 40개국 17개 클라우드 데이터센터 규모다 (슬라이드 2~3).

---

## 2. 문제: 사업이 늘어날 때마다 클러스터가 비대해진다 (슬라이드 6~8)

### 2.1 비대해지는 과정

신규 상품이 하나 생길 때마다 언더레이 클러스터에 뭔가가 덧붙는다.

- **GPU 상품** → 전용 노드, GPU 드라이버, 최신 K8s 버전
- **고성능 네트워크 상품** → SR-IOV, 전용 NIC, 패킷 성능 튜닝
- **스토리지 상품** → 전용 CSI, 대용량 I/O
- **DMZ · 보안 상품** → 격리된 인증/인가
- **사용자 · 존 확장** → 노드와 워크로드가 계속 증가

결과적으로 클러스터는 이렇게 커진다.

| 단계 | 구성 | 규모 |
|---|---|---|
| Compute 중심 | OpenStack | 수십 노드 |
| 서비스 추가 | + Storage · DMZ | 특수 애드온/드라이버가 붙은 수십 노드 |
| 현재 | + GPU · 고성능 네트워크 + 특수 Compute + Multi Zone + Private Zone | 복잡도가 매우 높은 수백 노드 |

**클러스터 스케일링 자체가 문제가 된다.**

### 2.2 단일 클러스터가 아파오는 네 지점

| # | 문제 | 구체적 증상 |
|---|---|---|
| 1 | 컴포넌트 누적 | CNI · CRI · CSI가 중복 설치, CRD 수백 개, 호스트 드라이버 계속 증가, 상품 간 의존성 확대 |
| 2 | 인가(AuthZ) 경계 | 쪼개기 어려움. Control·Compute·Service 격리가 네임스페이스 수준에서 멈춤. 실제로는 노드 수준 격리가 필요 |
| 3 | 버전 관리 부담 | K8s 버전과 드라이버 버전이 커플링됨. 한 번 버전을 올리면 전체 재검증. 업그레이드가 계속 밀림 |
| 4 | 장애 경계 | 한 워크로드의 데이터 플레인 문제가 전체로 번짐. 하나가 죽으면 다 죽는다 |

발표의 핵심 문장: **"Kubernetes는 확장을 위해 만들어졌지만, 진짜 비용은 운영자가 떠안아야 하는 복잡도다."**

### 2.3 kubectl로 본 실상 (슬라이드 8)

```
$ kubectl get crds | wc -l
347

$ kubectl get crds | grep cluster
clusterclasses.cluster.x-k8s.io
clusterresourcesets.addons.cluster...
clusters.cluster.x-k8s.io      ← 이름 충돌
clusters.postgresql.cnpg.io    ← 이름 충돌

$ kubectl get cluster
# 어느 쪽? CAPI vs CNPG
```

```
$ kubectl get pods -A -owide | grep node-01
multus-58x2k          Running ← CNI
calico-node-x7k2      Running ← CNI
ovn-controller-p9q1   Running ← CNI
csi-cinder-node-4h8s  Running ← CSI
csi-rbd-node-w2m5     Running ← CSI

$ ls /opt/cni/bin
bridge calico multus ovn-k8s-cni...

$ crictl info | grep -i runtime
containerd / kata-containers ← CRI
```

CRD가 수백 개이고 `cluster`라는 이름이 두 프로젝트에서 충돌한다. 노드 하나에 CNI·CSI·CRI가 겹겹이 쌓여 있다.

---

## 3. 접근: 용도별로 클러스터를 쪼갠다 (슬라이드 9~12)

### 3.1 방향

**"용도별로 클러스터를 나눈다. 클러스터를 단순하게 유지하자."**

### 3.2 그런데 쪼개면 비용이 × N 이 된다 (슬라이드 10)

단순히 클러스터를 여러 개 만들면 모든 게 클러스터 수만큼 곱해진다.

| × N 되는 것 | 내용 |
|---|---|
| 컨트롤 플레인 생명주기 | 클러스터마다 마스터 설치·업그레이드·패치 |
| 컨트롤 플레인 리소스 | 클러스터마다 마스터 노드 물리 서버 필요 |
| 플릿 관리 | 상태·버전·헬스를 클러스터별로 추적 |
| 모든 것의 복제본 | 설정, 인증서, RBAC, 모니터링 |

**"쪼개는 건 쉬운 답이지만, 대가는 모든 것 × N 이다."**

### 3.3 Cluster API가 이 대가를 없앤다 (슬라이드 11)

핵심 아이디어: **컨트롤 플레인을 물리 마스터 노드가 아니라 "Control Cluster의 Pod"로 돌린다.**

- Control Cluster도 그냥 Kubernetes다.
- Cluster A/B/C의 마스터(etcd, apiserver, controller)가 Control Cluster 안에 **Pod로** 뜬다.
- 클러스터별 물리 마스터 서버가 사라진다 → 컨트롤 플레인 통합(Consolidated ControlPlane).
- 이 모든 것이 Cluster API로 선언적으로 생성·관리된다.

이 방식을 업계 용어로 **hosted control plane**이라 부른다.

### 3.4 재설계 4원칙 (슬라이드 12)

1. **노드 수준 요구사항은 격리된다** — 드라이버·런타임·특수 커널은 필요한 노드에만 설치한다.
2. **장애는 클러스터 경계에서 멈춘다** — 데이터 플레인 장애를 관리 플레인에서 떼어놓는다.
3. **각 서비스가 자기 기술 스택을 소유한다** — Kubernetes, CNI, CSI 버전을 독립적으로 고른다.
4. **업그레이드는 작고 반복 가능하다** — 클러스터 또는 노드 풀을 하나씩 교체한다.

---

## 4. 아키텍처 (슬라이드 13, 15~18)

### 4.1 완전히 독립된 용도별 클러스터 (슬라이드 13)

| 클러스터 | 용도 | K8s 버전 | 노드 형태 |
|---|---|---|---|
| Compute | 고객 VM | v1.31 | 물리 서버 (BM) |
| AI / GPU | 학습 · 추론 | v1.35 | 물리 서버 (BM) |
| DMZ | 인증 · 프록시 | v1.34 | KubeVirt VM (Control Cluster 위) |

각 클러스터의 컨트롤 플레인은 **Control Cluster의 네임스페이스 하나**로 존재한다. `ns: compute`, `ns: ai-gpu`, `ns: dmz` 안에 apiserver와 etcd가 들어 있다. 즉 **Control Cluster의 네임스페이스 = 그 클러스터의 컨트롤 플레인**이다.

그 위 Control Layer에서 Keystone, Nova, Neutron, Glance, Cinder, AI Inference, Network Control, Container Service 같은 OpenStack/서비스 컴포넌트가 돈다.

### 4.2 Control Cluster 내부 (슬라이드 15)

`Namespace: control-cluster` 안에 이런 것들이 뜬다.

| 컴포넌트 | Kubernetes 리소스 종류 |
|---|---|
| kube-apiserver | Deployment |
| controller-manager | Deployment |
| scheduler | Deployment |
| etcd | StatefulSet |
| konnectivity-server | Deployment |
| metrics-server | Deployment |
| LB (VIP) | Service, TCP 6443 / 8132 |

- ServiceAccount · Secret · 인증서, anti-affinity · requests · PDB가 함께 설정된다.
- **이중화, 스케일링, 복구가 전부 "Pod 스케줄링"으로 처리된다.** 마스터 노드를 손으로 세우지 않는다.
- 워커 노드(BM 또는 VM)는 VIP를 통해 join하고 watch한다.
- **호스팅된 컨트롤 플레인은 Control Cluster 자원을 쓰므로, 워커 용량은 온전히 워크로드에 남는다.**

### 4.3 Konnectivity: 두 개의 네트워크, 하나의 API 서버 (슬라이드 16)

여기가 기술적으로 가장 까다로운 부분이다.

**문제 상황:**

kube-apiserver와 metrics-server는 **서로 다른 클러스터의 Pod**다. 각자 자기 클러스터의 오버레이 네트워크 위에 있다.

| | Control Cluster | Workload Cluster (예: compute) |
|---|---|---|
| Pod CIDR | 10.128.0.0/16 | 10.244.0.0/16 |
| Service CIDR | 172.20.0.0/16 | 10.96.0.0/16 |
| 예시 Pod | kube-apiserver 10.128.3.7, etcd 10.128.3.9 | metrics-server Pod IP 10.244.1.25, Service IP 10.96.0.10 |

apiserver(10.128.3.7, 오버레이 A)가 metrics-server(10.96.0.x, 오버레이 B)를 호출하려 하면 **경로가 없다**. 각 오버레이는 자기 클러스터 안에서만 존재하기 때문에 패킷이 갈 곳이 없다.

**해결책 — Konnectivity 터널:**

1. Control Cluster의 `konnectivity-server` Pod가 apiserver와 UDS(egress selector)로 연결된다.
2. Workload Cluster의 `konnectivity-agent` Pod가 **밖으로 다이얼 아웃**해서 `:8132`로 접속한다.
3. 그 위에 mTLS gRPC 터널이 유지된다.
4. **API 서버 → 클러스터 방향 트래픽(집계 API, 웹훅, exec/logs)이 전부 이 터널을 탄다.**

에이전트가 바깥으로 먼저 연결을 여는 방식이라, 워커 쪽에 인바운드 경로를 열 필요가 없다.

### 4.4 Cluster API란 무엇인가 (슬라이드 17)

CNCF 프로젝트로, **클러스터 자체를 Kubernetes 리소스로 선언**한다.

> Pod를 선언하면 컨테이너를 얻듯, Cluster를 선언하면 클러스터를 얻는다.

**① 컨트롤 플레인 자동화**

```
Cluster --infrastructureRef--> InfraCluster
   |
   +--controlPlaneRef--> ControlPlane
```
마스터 생성 · HA · 버전 관리, 인프라 준비를 담당한다.

**② 노드 자동화**

```
MachineDeployment --> MachineSet --> Machine --infrastructureRef--> InfraMachine
```
`replicas` 수만큼 실제 서버/VM을 노드로 만든다. (Deployment → ReplicaSet → Pod 구조와 똑같은 모양이다.)

**동작 원리:** 컨트롤러가 선언된 상태와 실제 상태를 계속 비교해서 수렴시킨다(reconcile).

**Provider:** AWS, OpenStack, vSphere 등 인프라 차이를 흡수하는 열린 계약이다. 직접 구현할 수도 있다.
→ **발표팀은 자체 베어메탈 언더레이 provider와 컨트롤 플레인 provider를 직접 만들었다.**

### 4.5 클러스터를 YAML로 선언하기 (슬라이드 18)

```yaml
kind: Cluster
metadata:
  name: sample
spec:
  controlPlaneRef:
    kind: SCPControlPlane
  infrastructureRef:
    kind: SCPCluster
---
kind: SCPControlPlane
spec:
  version: v1.35.0
  podCidr: 10.244.0.0/16
  replicas: 3
---
kind: SCPCluster
spec:
  controlPlaneEndpoint:
    host: 192.0.2.10
```

```yaml
kind: UnderlayMachineTemplate
metadata:
  name: sample-worker
spec:
  template:
    spec:
      underlayMachine:
        ...
---
kind: MachineDeployment
spec:
  clusterName: sample
  replicas: 3
  template:
    spec:
      infrastructureRef:
        kind: UnderlayMachineTemplate
        name: sample-worker
```

**실제로 만지는 값은 네 개뿐이다.**

| 필드 | 의미 |
|---|---|
| `controlPlaneRef` / `infrastructureRef` | 1) 컨트롤 플레인 프로비저닝, 2) 인프라(머신 노드) 프로비저닝 |
| `version: v1.35.0` | **이 값을 바꾸는 것이 곧 업그레이드다** |
| `replicas: 3` | 컨트롤 플레인이면 apiserver 개수, MachineDeployment면 노드 개수 |
| `underlayMachine` | 노드 형태 (베어메탈 / KubeVirt VM) |

템플릿을 재사용하고 name, endpoint, replicas만 바꾸면 된다.

> 모든 `SCP*` / `Underlay*` kind는 발표팀이 만든 자체 CRD + 컨트롤러다. 컨트롤 플레인은 Deployment로, etcd는 StatefulSet으로, 노드는 MachineDeployment로 구현된다.

---

## 5. 이 전략이 준 네 가지 (슬라이드 19)

| # | 효과 | 내용 |
|---|---|---|
| ① | 손쉬운 확장 / 업그레이드 | 확장 = replicas 변경 · 생성 = 선언 한 번 · 업그레이드 = 이미지 교체 |
| ② | 독립적인 클러스터와 스택 | 자체 버전 · CNI · CSI · 분리된 보안 경계 · 장애가 한 클러스터에 머묾 |
| ③ | 자원 활용률 개선 | 클러스터 간 리밸런싱 · 증설 없이 피크 흡수 · 유휴 시간 최소화 |
| ④ | 추적·재현 가능한 운영 | IaC로 형상을 Git에 · 이력 · 리뷰 · 롤백 · 사람과 AI 모두가 읽고 쓸 수 있음 |

---

## 6. ① 손쉬운 확장과 업그레이드 (슬라이드 20~23)

### 6.1 모든 클러스터 형상이 Git 저장소 하나에 (슬라이드 21)

`clusters/az-a/ai-gpu.yaml`:

```yaml
kind: Cluster
metadata:
  name: ai-gpu-az-a
spec:
  purpose: ai-training
  gpu: true
  version: v1.35
  replicas: 3
```

Control Cluster에서 도는 Cluster API가 **선언된 형상과 실제 상태를 계속 수렴**시킨다. 버전 변경, 노드 교체, 스케일링이 전부 "같은 종류의 편집"이 된다.

| 클러스터 | 버전 |
|---|---|
| Compute | v1.31 |
| Service | v1.28 |
| AI / GPU | v1.35 |
| Edge / Storage | v1.31 |

- 이력 · 리뷰 · 승인 · 롤백이 코드와 동일하다.
- 서버에 로그인할 일이 없다.
- 저장소와 실제 클러스터가 항상 일치한다.

### 6.2 클러스터 생성 흐름 (슬라이드 22)

| 단계 | 주체 | 내용 |
|---|---|---|
| 1 | **사람** | Git에 선언을 커밋한다 — **운영자의 일은 여기서 끝난다** |
| 2 | 자동 | 컨트롤 플레인이 MGMT 클러스터에 생성된다 |
| 3 | 자동 | 물리 서버가 준비된다 (베어메탈 예약 · 프로비저닝) |
| 4 | 자동 | 노드가 클러스터에 join한다 |
| 5 | 자동 | Ready → 핸드오버. GitOps가 이어받아 앱을 배포한다 |

진행 상황은 Kubernetes 오브젝트 status로 계속 보인다.

### 6.3 유스케이스: 멀티 AZ (슬라이드 23)

```
clusters/
 ├ az-a/
 ├ az-b/
 └ az-c/
```

- AZ A: Service, Compute, AI/GPU, Edge/Storage — 동일한 4개 용도 클러스터
- AZ B: 같은 선언, 크기만 다름
- AZ C (신규): Git에 선언을 추가하면 자동 구축

용량과 네트워킹만 준비되면, 새 AZ는 Git을 통해 **같은 청사진을 그대로 재사용**한다.

---

## 7. ② 클러스터별 독립 기술 스택 (슬라이드 24~25)

| 클러스터 | 버전 | CNI | 범위 | 비고 |
|---|---|---|---|---|
| Compute | v1.31 | Cilium | Zonal | 최신 기능보다 안정성 우선. 고객 VM |
| Hyper Network Service | v1.35 | multus + ovs + SR-IOV | Regional | 고성능 네트워킹용. 네트워크 드라이버 필요 |
| AI / GPU | v1.35 | multus + Cilium + SR-IOV | Regional | 최신 기능 · 빠른 데이터 접근. RDMA device plugin |
| Storage | v1.31 | Calico | Zonal | 대용량 순차 I/O에 튜닝 |
| DMZ (Proxy) | v1.35 | Cilium | Regional | 노출 구간 — 강화된 네트워크 정책 |

버전이 v1.28부터 v1.35까지 섞여 있어도 문제가 없다. **각 클러스터가 자기 속도로 움직인다.**

---

## 8. ③ 자원 활용률 개선 (슬라이드 26~28)

### 8.1 왜 CSP에게 중요한가 (슬라이드 27)

> 매출은 판매된 용량에서 나온다. 유휴 노드는 돈 주고 산 하드웨어가 아무것도 벌지 못하는 상태다. **활용률이 곧 마진이다.**

**커밋 하나로 리밸런싱이 일어난다.**

| 단계 | 내용 |
|---|---|
| 1 | `git commit` — B: 6 → 3, A: 3 → 6 |
| 2 | Cluster API가 양쪽을 reconcile |
| 3 | 클러스터 B가 drain — cordon · delete · clean |
| 4 | 공유 풀로 노드 반납 |
| 5 | 클러스터 A가 확보 — 머신 생성 (BM / VM) |

반납과 확보가 **같은 reconcile 루프**다. 몇 분 뒤면 끝나고, 새 하드웨어는 한 대도 필요 없다.

- 같은 고정 풀 — 서버 추가 구매 제로
- 유휴 시간 ↓ = 마진 ↑
- 양방향 — 숫자 하나, 커밋 하나

### 8.2 유스케이스: 시간대별 GPU 리밸런싱 (슬라이드 28)

| 시간대 | 우선순위 | GPU 배치 |
|---|---|---|
| 업무 시간 09:00~18:00 | 추론(Inference) 우선 — 사용자 접속 중 | 추론 쪽에 GPU 다수, 학습은 축소 |
| 업무 외 18:00~09:00 | 학습(Training) 우선 — 사용자 없음 | 추론은 축소, 학습이 풀 스피드 |

각 이동은 **선언 하나의 변경**이며, 다른 클러스터에는 아무 영향이 없다.

> 증설이 아니다. 같은 GPU에서 유휴 시간을 걷어냈을 뿐이다.

---

## 9. ④ IaC — 모든 것을 코드로 (슬라이드 29~30)

저장소 구조 (`samsung-cloud/cluster-infra`, 슬라이드 30 스크린샷):

```
base/
 ├ compute.yaml
 ├ hyper-network.yaml
 ├ ai-gpu.yaml
 └ dmz.yaml
clusters/
 ├ dev/
 ├ kr-west1/
 │   └ az-a/
 │       ├ compute/
 │       │   ├ cluster.yaml
 │       │   ├ md-standard.yaml
 │       │   ├ md-highmem.yaml
 │       │   └ md-highcpu.yaml
 │       ├ hyper-network.yaml
 │       ├ ai-gpu.yaml
 │       └ dmz.yaml
 ├ kr-west2/ · kr-east1/ · na-west1/ ...
```

머신 타입별로 MachineDeployment를 하나씩 둔다 (standard · highmem · highcpu).

`compute/md-standard.yaml` 예시:

```yaml
kind: MachineDeployment
metadata:
  name: compute-az-a-standard
spec:
  clusterName: compute-az-a
  replicas: 24
  template:
    spec:
      machineType: std-v3     # 16 vCPU · 64 GiB
      version: v1.31          # Compute cluster · Cilium · zonal
      infrastructureRef:
        kind: BareMetalMachineTemplate
        name: std-v3-template

# 같은 클러스터의 형제 풀:
#   md-highmem.yaml → mem-v3  (8 vCPU · 128 GiB)  VM hosts, memory-bound
#   md-highcpu.yaml → cpu-v3  (32 vCPU · 64 GiB)  VM hosts, cpu-bound
```

커밋 메시지도 그대로 운영 기록이 된다. 예: `scale compute standard pool 18 → 24`, `enable RDMA device plugin - multus + Cilium + SR-IOV`, `hardened network policy — exposed zone (v1.35)`.

---

## 10. 하나의 터미널에서 보는 전체 인프라 (슬라이드 33)

```
$ scpctl get clusters -A | head -14   # 모든 리전 · 존 · 용도, 명령 하나
NAMESPACE  NAME             CLUSTERCLASS    PHASE          VERSION  NODES  AGE
dev        compute-az-a     compute         Provisioned    v1.31    12     520d
kr-west1   compute-az-a     compute         Provisioned    v1.31    86     412d
kr-west1   compute-az-b     compute         Provisioned    v1.31    74     412d
kr-west1   hyper-net-az-a   hyper-network   Provisioned    v1.35    12     180d
kr-west1   ai-gpu-az-a      ai-gpu          Provisioned    v1.35    48     150d
kr-west1   dmz-az-a         dmz             Provisioned    v1.35    6      412d
kr-west2   compute-az-a     compute         Provisioned    v1.31    62     390d
kr-west2   ai-gpu-az-a      ai-gpu          Provisioned    v1.35    32     120d
kr-east1   compute-az-a     compute         Provisioned    v1.31    58     365d
kr-east1   dmz-az-a         dmz             Provisioned    v1.35    8      365d
na-west1   compute-az-a     compute         Provisioned    v1.31    44     201d
na-west1   hyper-net-az-a   hyper-network   Provisioned    v1.35    8      96d
na-west1   ai-gpu-az-a      ai-gpu          Provisioning   v1.35    -      4m    ◀ new cluster · PR #214
                                                                              (+36 more)

# 49 clusters · 9 regions + dev · 20 AZs — 명령 하나, SSH 없음, 클러스터별 도구 없음

$ git log --oneline -1 && git diff HEAD~1   # 풀 스케일링 = 한 줄 커밋
9f3c2e1 scale compute standard pool 18 → 24  (hansol.park, 2 minutes ago)
--- a/clusters/kr-west1/az-a/compute/md-standard.yaml
+++ b/clusters/kr-west1/az-a/compute/md-standard.yaml
-  replicas: 18
+  replicas: 24

$ scpctl -n kr-west1 get machinedeployment compute-az-a-standard -w
NAME                    CLUSTER        REPLICAS  READY  UPDATED  PHASE
compute-az-a-standard   compute-az-a   24        21     24       ScalingUp
compute-az-a-standard   compute-az-a   24        24     24       Running
# 컨트롤러가 알아서 선언 = 실제로 수렴시킨다 — 커밋을 머지하면 끝
```

---

## 11. 향후 로드맵: IaC 위의 AI 에이전트 (슬라이드 31)

| 단계 | 내용 |
|---|---|
| 1. 리전 전체 클러스터 | 즉시 인벤토리 — 클러스터 · BM/VM · vCPU · 메모리. 선언된 상태에서 실시간 인벤토리를 얻는다 |
| 2. 실시간 상태 분석 | Prometheus · OpenSearch · APM으로 클러스터/풀별 사용량 대 유휴량 분석. 핫스팟, 낭비, 드리프트를 찾는다 |
| 3. PR로 제안 | 제안을 git diff로: `replicas 12 → 8`. PR/리뷰로 사람이 루프에 남는다 |

인프라가 코드로 표현되어 있기 때문에 AI 에이전트가 읽고 제안할 수 있고, 제안은 PR이라는 사람이 검토 가능한 형태로 나온다.

---

## 12. 결론 (슬라이드 34)

**왜 이 길을 택했나**

| 이유 | 내용 |
|---|---|
| 큰 규모 | 이기종 베어메탈 · VM 인프라를 여러 상품으로 서비스 |
| 지속적 성장 | 새 리전, AZ, 서비스가 계속 추가됨 |
| 기존 방식의 한계 | 손으로 만든 클러스터: 느린 확장, 위험한 업그레이드, 높은 관리 비용. 언더레이 클러스터 수동 설치에 몇 주씩 소요 |

→ **확장을 전제로 설계된 아키텍처가 필요했다.**

**무엇을 얻었나**

① 손쉬운 확장과 업그레이드 · ② 독립적인 클러스터 · ③ 높은 활용률 · ④ 모든 것을 코드로

> **클러스터를 손으로 빚은 환경이 아니라, 선언적이고 교체 가능한 인프라로 다뤄라.**

---

## 부록: 슬라이드 인덱스

| # | 제목 |
|---|---|
| 1 | 표지 — Declarative Underlays |
| 2 | Samsung Cloud Platform Overview |
| 3 | Global Network |
| 4 | In the Spirit of the Conference |
| 5 | OpenStack on Kubernetes: Not a New Topic |
| 6 | Problem: the Cluster Grows with Every New Business |
| 7 | Where a Single Cluster Starts to Hurt |
| 8 | The View from kubectl |
| 9 | Our Approach — Split clusters by purpose |
| 10 | Cost of Splitting into Multiple Clusters |
| 11 | ClusterAPI to the Rescue |
| 12 | Redesign Principles |
| 13 | Declarative Kubernetes — Fully Independent Structures |
| 14 | (섹션) Technical Details |
| 15 | Inside the Control Cluster |
| 16 | Two Networks, One API Server — Konnectivity |
| 17 | What Is Cluster API? |
| 18 | Cluster Declaration in YAML |
| 19 | Four Things This Strategy Gave Us |
| 20 | (섹션) ① Scale/Upgrade with Ease |
| 21 | Every Cluster Shape in One Git Repo |
| 22 | Cluster Creation Flow |
| 23 | Usecase: Multi-AZ |
| 24 | (섹션) ② Independent Clusters and Technology Stacks |
| 25 | Usecase: Tech Stacks per Cluster |
| 26 | (섹션) ③ Improve Resource Utilization |
| 27 | Rebalance: Move Nodes from Idle to Busy |
| 28 | Usecase: Rebalancing GPUs by Time of Day |
| 29 | (섹션) ④ IaC — Infrastructure as Code |
| 30 | Inside the Repo |
| 31 | Future Roadmap: AI Agents on Top of IaC |
| 32 | (섹션) Wrap-up |
| 33 | The Whole Infrastructure from One Terminal |
| 34 | Conclusion: Why This Route — and What It Gave Us |
| 35 | Thank You · 谢谢 |
