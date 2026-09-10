# In-Place PVC Re-Binding: Zero-Downtime Disk Migration Using Only the Kubernetes API

**출처:** KubeCon + CloudNativeCon + OpenInfra Summit + PyTorch Conference China 2026
**일시/장소:** 2026-09-09 11:00, 30분, 7F Pearl Hall
**발표자:** Nibir Bora (Commure, Engineering Manager, Core Infrastructure) / Maxim Nazarenko (Amazon, Senior Software Engineer)
**슬라이드:** 39장 PDF

---

## 1. 배경과 목표

Commure는 헬스케어 RCM/앰비언트 플랫폼이다. 연 250억 달러 이상이 시스템을 통과하고, 연 1억 건 이상의 환자 상호작용을 처리하며, 50만 명 이상의 임상의가 사용한다.

인프라 규모:

| 항목 | 규모 |
|---|---|
| 클러스터 | 100+ |
| 노드 | 5,000+ |
| Pod | 35,000+ |
| 일일 스케줄링 | 200,000+ |
| 마이크로서비스 | 1,200 |
| 리전 | 3 리전 멀티리전 액티브 |
| CPU 코어 | 약 100,000 |
| 메모리 | 350TiB+ |

목표:

- Kubernetes가 2020년에 in-tree 스토리지 플러그인을 deprecate 했다.
- Azure managed disk 약 500개를 in-tree 드라이버에서 CSI 드라이버로 이관해야 한다.
- 글로벌 비즈니스라 24/7 무중단이 요구된다.
- 대상 워크로드는 ClickHouse, CockroachDB, ElasticSearch, Kafka, Prometheus 등 상태 저장 시스템이다.

## 2. 왜 어려운가

Kubernetes 스토리지 리소스는 스코프가 나뉜다. PVC는 네임스페이스 스코프, PV와 StorageClass는 클러스터 스코프다.

동적 볼륨 프로비저닝의 흐름:

1. StatefulSet의 `volumeClaimTemplates`가 `storageClassName: legacy-storage-class`를 참조한다.
2. 해당 StorageClass의 `provisioner`가 `kubernetes.io/azure-disk`(in-tree)다.
3. 프로비저닝된 PV는 `spec.persistentVolumeSource.azureDisk.diskURI`로 실제 Azure 디스크를 가리킨다.
4. PV의 `claimRef`가 PVC의 name, namespace, **uid**까지 포함해 강하게 바인딩된다.

핵심 제약은 대부분의 필드가 immutable이라는 점이다. StorageClass의 provisioner를 바꿀 수 없고, 기존 PV의 볼륨 소스를 in-tree에서 CSI로 바꿀 수도 없다.

> **Kubernetes의 영속성 원칙:** 스토리지는 durable하고 안정적인 리소스이며, Pod는 일시적이고 교체 가능한 존재다.

## 3. 활용한 Kubernetes 내부 동작 3가지

### 3.1 StorageClass 객체는 수동적(passive)이다

StorageClass는 프로비저닝 시점에만 참조된다. 이미 바인딩된 PV/PVC는 StorageClass를 다시 읽지 않는다. 따라서 **같은 이름으로 지우고 다시 만들 수 있다.**

```yaml
# Legacy
kind: StorageClass
metadata:
  name: legacy-storage-class
provisioner: kubernetes.io/azure-disk
parameters:
  storageaccounttype: Premium_LRS
  kind: Managed
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
```

```yaml
# New
kind: StorageClass
metadata:
  name: legacy-storage-class
provisioner: disk.csi.azure.com
parameters:
  skuName: Premium_LRS
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
```

### 3.2 PV의 claimRef가 바인딩 동작을 결정한다

`claimRef`에 `uid`와 `resourceVersion`이 있으면 특정 PVC 인스턴스에 확정 바인딩된다(Firm binding). 반대로 name과 namespace만 남기고 `uid`와 `resourceVersion`을 **생략하면** 그 PV는 "해당 이름의 PVC가 나타나면 바인딩되겠다"는 예약 상태(PV available)가 된다.

```yaml
# Firm binding
kind: PersistentVolume
spec:
  claimRef:
    kind: PersistentVolumeClaim
    name: data-pvc
    namespace: production
    uid: 8cbb0f8e...
    resourceVersion: "123456"
  azureDisk:
    diskURI: /subscriptions/.../disks/data-disk
```

```yaml
# PV available (예약된 상태)
kind: PersistentVolume
spec:
  claimRef:
    kind: PersistentVolumeClaim
    name: data-pvc
    namespace: production
    # uid: OMITTED
    # resourceVersion: OMITTED
  csi:
    driver: disk.csi.azure.com
    volumeHandle: /subscriptions/.../disks/data-disk
```

이것이 이 발표가 말하는 "honeypot PV"다. 같은 물리 디스크를 CSI 드라이버로 가리키면서, 미래에 생성될 동일 이름의 PVC를 기다린다.

### 3.3 pvc-protection finalizer

PVC를 삭제해도 이를 사용하는 Pod가 살아 있으면 `kubernetes.io/pvc-protection` finalizer 때문에 `deletionTimestamp`만 찍히고 `status.phase: Bound` 상태로 남는다. 즉 **PVC 삭제와 Pod 삭제가 함께 일어나야** 실제로 정리된다.

```yaml
kind: PersistentVolumeClaim
metadata:
  name: data-db-0
  namespace: production
  deletionTimestamp: "2026-09-05T18:42:00Z"
  finalizers:
    - kubernetes.io/pvc-protection
status:
  phase: Bound
```

## 4. 알고리즘 5단계

### Step 1. 레거시 StorageClass 삭제

```bash
kubectl delete sc legacy-storage-class
```

### Step 2. 같은 이름으로 CSI StorageClass 생성

```bash
kubectl apply -f - <<'EOF'
kind: StorageClass
metadata:
  name: legacy-storage-class
provisioner: disk.csi.azure.com
parameters:
  skuName: Premium_LRS
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
EOF
```

### Step 3. 레거시 PV의 reclaim policy를 Retain으로 변경

PVC를 지웠을 때 실제 Azure 디스크가 삭제되지 않도록 보호한다. 이 단계를 빠뜨리면 데이터가 사라진다.

```bash
kubectl patch pv $PV_NAME -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}'
```

### Step 4. 새 CSI PV("honeypot") 생성

원본 managed disk를 그대로 가리키고, `claimRef`에서 `uid`와 `resourceVersion`을 생략한다.

```yaml
kind: PersistentVolume
spec:
  claimRef:
    kind: PersistentVolumeClaim
    name: data-app-0
    namespace: production
    # uid: OMITTED
    # resourceVersion: OMITTED
  csi:
    driver: disk.csi.azure.com
    volumeHandle: /subscriptions/.../disks/data-disk
```

### Step 5. 재바인딩 트리거

레거시 PVC와 StatefulSet Pod를 함께 삭제한다. pvc-protection finalizer 때문에 둘 다 지워야 진행된다.

```bash
kubectl delete pvc $PVC_NAME
kubectl delete pod $POD_NAME
```

이후 StatefulSet 컨트롤러가 새 Pod와 새 PVC를 만들고, 새 PVC는 대기 중이던 honeypot PV를 찾아 바인딩된다. 디스크는 그대로이므로 데이터가 보존되고, 중단은 Pod 재시작 시간뿐이다.

### 그림으로 본 흐름

1. 레거시 PV의 reclaim policy를 retain으로 설정한다.
2. 원본 managed disk를 가리키는 CSI honeypot PV를 만든다. claimRef의 uid와 resourceVersion은 생략한다.
3. 레거시 PVC와 StatefulSet Pod를 삭제해 재바인딩을 트리거한다.
4. StatefulSet 컨트롤러가 새 Pod와 PVC를 만들고, PVC가 honeypot PV를 찾아 바인딩된다.

## 5. 결과

전체 마이그레이션에 **2개월**이 걸렸다. 진행률 곡선은 S자 형태였다. 초기 4~5주는 0%에 머물며 검증과 자동화 준비에 쓰였고, 이후 급격히 상승해 약 38%에 도달했다. 중반에는 40%대에서 완만하게 진행되다가, 마지막 구간에서 다시 가파르게 올라 100%를 달성했다.

## 6. 대안 비교

| 전략 | 다운타임 영향 | 데이터 리스크 | 운영 복잡도 | 핵심 서비스 적합성 |
|---|---|---|---|---|
| Microsoft Static Volume | High (전체 재배포) | Low | Medium | Low |
| Orphan and Adopt | High (장기 중단 위험) | Low | High | Very Low |
| Backup and Restore | High (백업+복원 시간) | Medium (일관성 문제) | Medium | Low |
| Forking the Control Plane | Low (완벽할 경우) | Very High (코어 K8s 수정) | Extreme (K8s 포크 필요) | Very Low |
| **In-Place PVC Re-Binding** | **Minimal (Pod 재시작)** | **Low (디스크에 데이터 보존)** | **High (깊은 전문성 필요)** | **High** |

## 7. 실패 사례

- **PV Multi-Attach 실패:** 이전 attach가 정리되기 전에 새 Pod가 볼륨을 붙이려 할 때 발생한다.
- **Pod 재생성과 PVC 사이의 레이스 컨디션:** StatefulSet 컨트롤러가 PVC보다 먼저 또는 늦게 움직이면서 생기는 타이밍 문제다.

## 8. 원칙

- 깊은 시스템 지식이 무식한 힘보다 낫다 (Deep systems knowledge trumps brute force).
- 실험이 운영 성숙도를 만든다 (Experimentation builds operational excellence).
- 규모에서의 신뢰성은 자동화가 핵심이다 (Automation is the key to reliability at scale).

---

## 부록 A. 초보자를 위한 배경 개념

이 발표를 이해하려면 아래 개념이 필요하다. Kubernetes 스토리지를 처음 보는 사람 기준으로 정리한다.

- **Pod:** 컨테이너가 실제로 실행되는 단위다. 언제든 죽고 다시 만들어질 수 있는 일회용 존재로 취급한다.
- **StatefulSet:** 데이터베이스처럼 상태를 가진 앱을 굴리는 컨트롤러다. Pod마다 고정된 이름(예: `db-0`, `db-1`)과 전용 디스크를 붙여준다.
- **PersistentVolume (PV):** 실제 디스크를 Kubernetes가 인식하는 객체로 표현한 것이다. 클러스터 전체에서 보이며, 어떤 드라이버로 어느 디스크를 쓰는지 적혀 있다.
- **PersistentVolumeClaim (PVC):** "이만한 디스크가 필요하다"는 신청서다. 네임스페이스 안에 있으며, Pod는 PV를 직접 보지 않고 PVC를 통해 디스크를 쓴다.
- **StorageClass:** 디스크를 어떤 방식으로 만들지 정한 템플릿이다. 어떤 드라이버(provisioner)를 쓸지, 디스크 등급은 무엇인지를 담는다.
- **바인딩(binding):** PVC 한 장과 PV 한 개가 짝이 되는 것이다. 짝이 지어지면 그 PVC를 쓰는 Pod가 해당 디스크를 마운트한다.
- **in-tree 드라이버:** 예전에는 클라우드별 스토리지 코드가 Kubernetes 본체 안에 들어 있었다. 이것이 in-tree다. 유지보수가 어려워 2020년에 폐기 예정으로 지정됐다.
- **CSI (Container Storage Interface):** 스토리지 드라이버를 Kubernetes 본체 밖에서 별도로 개발·배포하는 표준 방식이다. in-tree의 대체재다.
- **reclaim policy:** PVC가 사라졌을 때 PV와 실제 디스크를 어떻게 할지 정한다. `Delete`면 디스크까지 지우고, `Retain`이면 디스크를 남긴다.
- **finalizer:** 객체를 지우려 할 때 "아직 정리할 게 남았다"며 삭제를 붙잡아 두는 표식이다. 조건이 해소돼야 실제로 지워진다.
- **immutable 필드:** 한 번 만들면 수정할 수 없는 항목이다. StorageClass의 provisioner, PV의 볼륨 소스가 여기에 해당해서 이 마이그레이션이 어려워진다.

### 이 발표의 핵심 아이디어를 한 문장으로

디스크는 그대로 두고, 그 디스크를 가리키는 Kubernetes 객체만 in-tree용에서 CSI용으로 갈아끼운다. Pod 재시작 시간 외에는 중단이 없다.

### 왜 "honeypot PV"라고 부르는가

새로 만든 CSI PV는 아직 존재하지 않는 PVC의 이름과 네임스페이스만 적어둔다. 나중에 StatefulSet이 같은 이름의 PVC를 만들면, 그 PVC가 이 PV를 발견하고 스스로 달라붙는다. 미리 놓아둔 덫에 걸리는 모양이라 honeypot이라고 부른다.

## 부록 B. 슬라이드 이미지 목록

`slides/slide-01.png` ~ `slides/slide-39.png` (총 39장, PDF 원본 순서 그대로 렌더링)

섹션별 대응:

| 슬라이드 | 내용 |
|---|---|
| 01 | 표지 |
| 02 | Commure 회사 소개와 미션 |
| 03-06 | 목표와 인프라 규모 (점진적 빌드업) |
| 07 | "What makes it hard?" 전환 슬라이드 |
| 08-10 | Kubernetes 스토리지 리소스 아이소메트릭 다이어그램 (PVC=네임스페이스 스코프, PV/StorageClass=클러스터 스코프) |
| 11-16 | 동적 볼륨 프로비저닝 흐름 |
| 17 | Kubernetes 영속성 원칙 인용구 |
| 18 | "Kubernetes Under the Hood" 전환 슬라이드 |
| 19 | StorageClass는 수동적이다 (legacy vs new YAML 비교) |
| 20-21 | claimRef가 바인딩을 결정한다 (Firm binding vs PV available) |
| 22 | pvc-protection finalizer |
| 23 | "Putting it Together - The Algorithm" 전환 슬라이드 |
| 24-26 | 알고리즘 1~3단계 |
| 27 | 4단계 아이소메트릭 다이어그램 (핵심 그림) |
| 28-31 | 알고리즘 4~5단계와 다이어그램 반복 |
| 32 | 결과: 2개월, S자 진행률 곡선 |
| 33 | 대안 비교표 |
| 34-35 | 실패 사례 |
| 36-38 | 원칙 3가지 |
| 39 | 마무리와 연락처 |
